import { EvolutionClient, TransportError } from '@tt/whatsapp';
import type { Env } from './types';
import { all, setting } from './db';
import { label, materialize, type Training } from './training';
import { renderTrainerSummary, type SummaryRow } from './trainer-summary';

export interface Job {
  id: string;
  dedupe_key: string;
  chat_jid: string;
  user_id: string | null;
  session_id: string | null;
  session_version: number | null;
  kind: string;
  text: string;
  due_at: number;
  expires_at: number;
  status: string;
  attempts: number;
  lease_token: string | null;
  preference_version: number | null;
}
export interface QueueInput {
  key: string;
  chat: string;
  text: string;
  kind?: string;
  userId?: string;
  sessionId?: string;
  version?: number;
  due?: number;
  expires?: number;
}
export function evolution(env: Env): EvolutionClient {
  return new EvolutionClient({
    url: env.EVOLUTION_URL,
    instance: env.EVOLUTION_INSTANCE,
    apiKey: env.EVOLUTION_API_KEY,
  });
}
export async function queue(db: D1Database, input: QueueInput, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,session_id,session_version,kind,text,due_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.key,
      input.chat,
      input.userId ?? null,
      input.sessionId ?? null,
      input.version ?? null,
      input.kind ?? 'reply',
      input.text,
      input.due ?? now,
      input.expires ?? now + 3600000,
      now,
    )
    .run();
}
const NOTICE_GAP = 10 * 60_000;
export function invitation(t: Training, _origin: string, now = t.invite_at): string {
  const combined = now >= t.late_at - NOTICE_GAP;
  return `🏓 *${t.version > 1 ? 'Training geändert' : 'Tischtennistraining'}*\n${label(t)}\n\n👍 Ich komme\n👎 Ich komme nicht${combined ? '\n⏰ Ich komme später' : ''}\n\nReagiere direkt auf diese Nachricht.`;
}
export function lateNotice(t: Training, _origin: string, now: number): string {
  const minutes = Math.max(0, Math.round((t.start_at - now) / 60000));
  return `⏰ *${minutes > 0 ? `Training in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}` : 'Das Training hat begonnen'}*\n${label(t)}\n\nDu kommst später? Tippe auf die ⏰-Reaktion unten.\nDoch pünktlich? Nimm deine Reaktion wieder zurück.`;
}
export async function planJobs(db: D1Database, now: number): Promise<void> {
  if ((await setting(db, 'enabled')) !== '1' || (await setting(db, 'privacy_ready')) !== '1')
    return;
  await materialize(db, now);
  const origin = await setting(db, 'origin');
  const sessions = await all<Training>(
    db,
    `SELECT s.* FROM training_sessions s JOIN groups g ON g.jid=s.group_jid WHERE s.status='scheduled' AND s.end_at>? AND s.invite_at<=? AND g.active=1 ORDER BY s.start_at LIMIT 100`,
    now,
    now,
  );
  for (const t of sessions) {
    // Upgrade already sent, still-current lateness prompts without reposting their text.
    const delivered = await all<Job & { provider_id: string }>(
      db,
      "SELECT * FROM outbox_jobs WHERE session_id=? AND session_version=? AND kind IN ('late','personal_late') AND status='sent' AND provider_id IS NOT NULL",
      t.id,
      t.version,
    );
    for (const job of delivered)
      await queue(
        db,
        {
          key: `clock:${job.id}`,
          chat: job.chat_jid,
          userId: job.user_id ?? undefined,
          sessionId: t.id,
          version: t.version,
          kind: job.user_id ? 'personal_clock' : 'clock',
          text: job.provider_id,
          expires: t.end_at,
        },
        now,
      );
    if (now < t.start_at)
      await queue(
        db,
        {
          key: `${t.id}:${t.version}:invite:group`,
          chat: t.group_jid,
          text: invitation(t, origin),
          kind: 'invite',
          sessionId: t.id,
          version: t.version,
          due: t.invite_at,
          expires: t.start_at,
        },
        now,
      );
    await queue(
      db,
      {
        key: `${t.id}:${t.version}:late:group`,
        chat: t.group_jid,
        text: lateNotice(t, origin, t.late_at),
        kind: 'late',
        sessionId: t.id,
        version: t.version,
        due: t.late_at,
        expires: t.end_at,
      },
      now,
    );
    const subscribers = await all<{ id: string; jid: string }>(
      db,
      `SELECT u.id,u.jid FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.group_jid=? AND m.active=1 AND u.registered_at IS NOT NULL AND u.reminders=1`,
      t.group_jid,
    );
    for (const u of subscribers) {
      // A new subscription is only eligible for future scheduled messages, never a past invitation.
      const consent = await db
        .prepare(
          "SELECT accepted,created_at FROM consents WHERE user_id=? AND purpose='reminders' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        )
        .bind(u.id)
        .first<{ accepted: number; created_at: number }>();
      if (consent?.accepted !== 1) continue;
      const since = consent.created_at;
      if (now < t.start_at && since <= t.invite_at)
        await queue(
          db,
          {
            key: `${t.id}:${t.version}:invite:${u.id}`,
            chat: u.jid,
            userId: u.id,
            text: invitation(t, origin),
            kind: 'personal_invite',
            sessionId: t.id,
            version: t.version,
            due: t.invite_at,
            expires: t.start_at,
          },
          now,
        );
      if (since <= t.late_at)
        await queue(
          db,
          {
            key: `${t.id}:${t.version}:late:${u.id}`,
            chat: u.jid,
            userId: u.id,
            text: lateNotice(t, origin, t.late_at),
            kind: 'personal_late',
            sessionId: t.id,
            version: t.version,
            due: t.late_at,
            expires: t.end_at,
          },
          now,
        );
    }
  }
}
async function permitted(db: D1Database, j: Job, now: number): Promise<boolean> {
  if (j.expires_at <= now) return false;
  if (j.session_id) {
    if ((await setting(db, 'enabled')) !== '1' || (await setting(db, 'privacy_ready')) !== '1')
      return false;
    const session = await db
      .prepare(
        'SELECT s.*,g.active FROM training_sessions s JOIN groups g ON g.jid=s.group_jid WHERE s.id=?',
      )
      .bind(j.session_id)
      .first<Training & { active: number }>();
    if (!session || !session.active || session.version !== j.session_version) return false;
    if (session.status === 'cancelled' && !['change', 'personal_change'].includes(j.kind))
      return false;
    // A rescheduled training whose invitation is already due needs one new,
    // answerable invitation, rather than a change notice followed by an invitation.
    if (
      j.kind === 'change' &&
      session.status === 'scheduled' &&
      session.invite_at <= now &&
      now < session.start_at
    )
      return false;
    if (['late', 'personal_late'].includes(j.kind)) {
      if (now > session.start_at + 5 * 60_000) return false;
      // A late-created or delayed invitation already includes the clock option.
      const nearbyInvite = await db
        .prepare(
          `SELECT 1 FROM outbox_jobs j WHERE j.session_id=? AND j.session_version=? AND j.chat_jid=?
         AND j.kind IN ('invite','personal_invite') AND
         ((j.status IN ('pending','processing','uncertain') AND j.due_at<=? AND j.expires_at>?) OR
          (j.status='sent' AND (EXISTS(SELECT 1 FROM messages m WHERE m.id=j.provider_id AND m.created_at>=?)
            OR EXISTS(SELECT 1 FROM outbox_jobs clock WHERE clock.dedupe_key='clock:'||j.id))))`,
        )
        .bind(j.session_id, j.session_version, j.chat_jid, now, now, now - NOTICE_GAP)
        .first();
      if (nearbyInvite) return false;
      if (
        j.user_id &&
        (await db
          .prepare(
            "SELECT 1 FROM attendance WHERE session_id=? AND user_id=? AND needs_confirmation=0 AND (response='no' OR punctuality='late')",
          )
          .bind(j.session_id, j.user_id)
          .first())
      )
        return false;
    }
    if (['clock', 'personal_clock'].includes(j.kind)) {
      const target = await db
        .prepare(
          "SELECT 1 FROM messages WHERE id=? AND chat_jid=? AND session_id=? AND session_version=? AND kind IN ('invite','personal_invite','late','personal_late')",
        )
        .bind(j.text, j.chat_jid, j.session_id, j.session_version)
        .first();
      if (!target) return false;
    }
    if (j.kind === 'trainer_summary') {
      const preference = await db
        .prepare(
          `SELECT p.* FROM trainer_summary_preferences p JOIN roles r ON r.user_id=p.user_id WHERE p.user_id=? AND p.enabled=1 AND p.version=? AND r.role IN ('owner','admin')`,
        )
        .bind(j.user_id, j.preference_version)
        .first<SummaryRow>();
      if (!preference) return false;
      const consent = await db
        .prepare(
          "SELECT accepted FROM consents WHERE user_id=? AND purpose='trainer_summary' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        )
        .bind(j.user_id)
        .first<{ accepted: number }>();
      if (consent?.accepted !== 1) return false;
    }
    if (j.kind.startsWith('personal_')) {
      const u = await db
        .prepare(
          `SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND u.reminders=1 AND u.registered_at IS NOT NULL AND m.group_jid=? AND m.active=1`,
        )
        .bind(j.user_id, session.group_jid)
        .first();
      if (!u) return false;
      const consent = await db
        .prepare(
          "SELECT accepted FROM consents WHERE user_id=? AND purpose='reminders' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        )
        .bind(j.user_id)
        .first<{ accepted: number }>();
      if (consent?.accepted !== 1) return false;
    }
  }
  return true;
}
export async function sendOutbox(
  env: Env,
  now = Date.now(),
  client = evolution(env),
): Promise<number> {
  // A crashed sender might already have reached WhatsApp. Do not blindly send it again.
  await env.DB.prepare(
    "UPDATE outbox_jobs SET status='uncertain',error='sender_interrupted' WHERE status='processing' AND lease_until<?",
  )
    .bind(now)
    .run();
  await env.DB.prepare(
    "UPDATE outbox_jobs SET status='expired' WHERE status='pending' AND expires_at<=?",
  )
    .bind(now)
    .run();
  const candidates = await all<Job>(
    env.DB,
    "SELECT * FROM outbox_jobs WHERE status='pending' AND due_at<=? AND expires_at>? ORDER BY due_at,created_at LIMIT 15",
    now,
    now,
  );
  let sent = 0;
  for (const candidate of candidates) {
    const token = crypto.randomUUID();
    const j = await env.DB.prepare(
      "UPDATE outbox_jobs SET status='processing',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=? AND status='pending' RETURNING *",
    )
      .bind(now + 120000, token, candidate.id)
      .first<Job>();
    if (!j) continue;
    if (!(await permitted(env.DB, j, now))) {
      await env.DB.prepare("UPDATE outbox_jobs SET status='cancelled' WHERE id=? AND lease_token=?")
        .bind(j.id, token)
        .run();
      continue;
    }
    try {
      let result: { id: string };
      let seedClock = false;
      let clockExpires = j.expires_at;
      if (['clock', 'personal_clock'].includes(j.kind)) {
        result = await client.sendReaction(j.chat_jid, j.text, '⏰');
      } else if (j.kind === 'contact') {
        const card = JSON.parse(j.text) as { name: string; phone: string };
        result = await client.sendContact(j.chat_jid, card.name, card.phone);
      } else {
        let text = j.text;
        if (
          j.session_id &&
          ['invite', 'personal_invite', 'late', 'personal_late', 'trainer_summary'].includes(j.kind)
        ) {
          const training = await env.DB.prepare(
            'SELECT * FROM training_sessions WHERE id=? AND version=?',
          )
            .bind(j.session_id, j.session_version)
            .first<Training>();
          if (!training) throw new TransportError('permanent');
          clockExpires = training.end_at;
          if (j.kind === 'trainer_summary') {
            const preference = await env.DB.prepare(
              'SELECT * FROM trainer_summary_preferences WHERE user_id=? AND enabled=1 AND version=?',
            )
              .bind(j.user_id, j.preference_version)
              .first<SummaryRow>();
            if (!preference) throw new TransportError('permanent');
            text = await renderTrainerSummary(env.DB, training, preference);
          } else if (['invite', 'personal_invite'].includes(j.kind)) {
            text = invitation(training, '', now);
            seedClock = now >= training.late_at - NOTICE_GAP;
          } else {
            text = lateNotice(training, '', now);
            seedClock = true;
          }
        }
        // Rendering reads fresh attendance. Recheck consent/role/version after those reads too.
        const lease = await env.DB.prepare(
          "SELECT id FROM outbox_jobs WHERE id=? AND lease_token=? AND status='processing'",
        )
          .bind(j.id, token)
          .first();
        if (!lease || !(await permitted(env.DB, j, now))) {
          await env.DB.prepare(
            "UPDATE outbox_jobs SET status='cancelled' WHERE id=? AND lease_token=? AND status='processing'",
          )
            .bind(j.id, token)
            .run();
          continue;
        }
        result = await client.sendText(j.chat_jid, text);
      }
      const clockJob: Job = {
        ...j,
        id: crypto.randomUUID(),
        dedupe_key: `clock:${j.id}`,
        kind: j.user_id ? 'personal_clock' : 'clock',
        text: result.id,
        due_at: now,
        expires_at: clockExpires,
        status: 'pending',
        attempts: 0,
        lease_token: null,
      };
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE outbox_jobs SET status='sent',provider_id=?,error=NULL,text=CASE WHEN kind IN ('reply','contact') THEN '' ELSE text END WHERE id=? AND lease_token=? AND status='processing'",
        ).bind(result.id, j.id, token),
        env.DB.prepare(
          'INSERT OR IGNORE INTO messages(id,chat_jid,session_id,session_version,kind,user_id,created_at) VALUES(?,?,?,?,?,?,?)',
        ).bind(result.id, j.chat_jid, j.session_id, j.session_version, j.kind, j.user_id, now),
        ...(seedClock
          ? [
              env.DB.prepare(
                `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,session_id,session_version,kind,text,due_at,expires_at,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
              ).bind(
                clockJob.id,
                clockJob.dedupe_key,
                j.chat_jid,
                j.user_id,
                j.session_id,
                j.session_version,
                clockJob.kind,
                result.id,
                now,
                clockExpires,
                now,
              ),
            ]
          : []),
      ]);
      // Independent durable job: a failed reaction can never resend the training text.
      if (seedClock) candidates.push(clockJob);
      sent++;
    } catch (error) {
      const retryable = error instanceof TransportError && error.kind === 'retryable';
      const permanent = error instanceof TransportError && error.kind === 'permanent';
      const delay = retryable
        ? Math.max(error.retryAfterMs ?? 0, Math.min(300000, 5000 * 2 ** Math.min(j.attempts, 6)))
        : 0;
      const status =
        retryable && j.attempts < 5 ? 'pending' : permanent || retryable ? 'failed' : 'uncertain';
      const code =
        error instanceof TransportError
          ? `${error.kind}:${error.status ?? 'network'}`
          : 'unknown_send_outcome';
      await env.DB.prepare(
        "UPDATE outbox_jobs SET status=?,due_at=?,error=? WHERE id=? AND lease_token=? AND status='processing'",
      )
        .bind(status, now + delay, code, j.id, token)
        .run();
      if (retryable) break; // Respect provider backoff for the entire small send batch.
    }
  }
  return sent;
}
