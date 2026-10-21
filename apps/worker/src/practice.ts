import { Hono } from 'hono';
import { z } from 'zod';
import {
  attendanceIntent,
  emptyAttendance,
  normalizeEmoji,
  reduceAttendance,
  type AttendanceState,
  type AttendanceChange,
} from '@tt/core';
import { TransportError, type MessageEvent } from '@tt/whatsapp';
import { getSession } from './auth';
import { all, setting } from './db';
import { evolution } from './outbox';
import { parseStatisticsRequest, compactStatistics } from './statistics';
import { createStatisticsLink, demoStatistics } from './statistics-links';
import type { AppBindings, Env } from './types';

interface Practice {
  id: string;
  owner_id: string | null;
  group_jid: string | null;
  subject: string;
  status: string;
  version: number;
  phase: string;
  expires_at: number;
  started_at: number;
  created_at: number;
}
const duration = 60 * 60000;
const ownGroup = (db: D1Database, owner: string) =>
  db.prepare('SELECT * FROM practice_groups WHERE owner_id=?').bind(owner).first<Practice>();
export async function isPracticeGroup(db: D1Database, jid: string, subject = ''): Promise<boolean> {
  return !!(await db
    .prepare('SELECT 1 FROM practice_groups WHERE group_jid=? OR subject=?')
    .bind(jid, subject)
    .first());
}
function job(
  db: D1Database,
  p: Practice,
  key: string,
  kind: string,
  text: string,
  now: number,
  state?: { sender: string; value: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,kind,text,due_at,expires_at,created_at,practice_id,practice_version)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM practice_groups p JOIN roles r ON r.user_id=p.owner_id WHERE p.id=? AND p.version=? AND p.expires_at>?)
    ${state ? 'AND EXISTS(SELECT 1 FROM practice_attendance WHERE group_id=? AND version=? AND sender_jid=? AND state=?)' : ''}`,
    )
    .bind(
      crypto.randomUUID(),
      `practice:${p.id}:${p.version}:${key}`,
      p.group_jid,
      kind,
      text,
      now,
      p.expires_at,
      now,
      p.id,
      p.version,
      p.id,
      p.version,
      now,
      ...(state ? [p.id, p.version, state.sender, state.value] : []),
    );
}
const intro = '🧪 *TT-Übung – kein echtes Training*';
const invitation = (changed = false) =>
  `${intro}\n${changed ? 'Der Übungstermin wurde verschoben. Bitte antworte erneut.' : 'Hier kannst du TT in Ruhe ausprobieren.'}\n\n👍 Ich komme\n👎 Ich komme nicht\n⏰ Ich komme später\n\nReagiere auf diese Nachricht oder schreibe zum Beispiel „Kann nicht“ und danach „Kann doch“. Eure Rückmeldungen gelten nur für diese Übung. Sie endet automatisch nach einer Stunde. Mit „Stats“ oder „/stats 6 Monate“ kannst du auch die Auswertung ausprobieren.`;

export function registerPracticeRoutes(app: Hono<AppBindings>): void {
  const router = new Hono<AppBindings & { Variables: { owner: string; jid: string } }>();
  router.use('*', async (c, next) => {
    const session = await getSession(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!session.role) return c.json({ error: 'forbidden' }, 403);
    c.header('Cache-Control', 'no-store');
    if (
      c.req.method !== 'GET' &&
      (c.req.header('Origin') !== (await setting(c.env.DB, 'origin')) ||
        new URL(c.req.url).origin !== (await setting(c.env.DB, 'origin')) ||
        c.req.header('Sec-Fetch-Site') === 'cross-site')
    )
      return c.json({ error: 'origin_mismatch' }, 403);
    c.set('owner', session.user.id);
    c.set('jid', session.user.jid);
    await next();
  });
  router.get('/', async (c) => {
    const p = await ownGroup(c.env.DB, c.get('owner'));
    if (!p) return c.json({ group: null, participants: [] });
    const participants =
      p.expires_at > Date.now()
        ? await all<{ display_name: string; state: string }>(
            c.env.DB,
            'SELECT display_name,state FROM practice_attendance WHERE group_id=? AND version=? ORDER BY display_name LIMIT 100',
            p.id,
            p.version,
          )
        : [];
    const delivery = await c.env.DB.prepare(
      "SELECT status FROM outbox_jobs WHERE practice_id=? AND practice_version=? AND kind!='practice_reply' ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
      .bind(p.id, p.version)
      .first<{ status: string }>();
    return c.json({
      group: {
        name: p.subject,
        status: p.status,
        version: p.version,
        phase: p.expires_at > Date.now() ? p.phase : 'stopped',
        expiresAt: p.expires_at,
        delivery: delivery?.status,
      },
      participants: participants.map((r) => ({
        name: r.display_name,
        ...(JSON.parse(r.state) as AttendanceState),
      })),
    });
  });
  router.post('/create', async (c) => {
    if ((await c.req.json().catch(() => null))?.confirm !== true)
      return c.json({ error: 'consent_required' }, 400);
    let p = await ownGroup(c.env.DB, c.get('owner'));
    if (p && p.status !== 'failed') return c.json({ ok: true }); // An uncertain create must never be repeated automatically.
    const phone = c.get('jid').endsWith('@s.whatsapp.net')
      ? c.get('jid')
      : await c.env.DB.prepare(
          "SELECT jid FROM identity_aliases WHERE user_id=? AND jid LIKE '%@s.whatsapp.net' LIMIT 1",
        )
          .bind(c.get('owner'))
          .first<string>('jid');
    if (!phone) return c.json({ error: 'practice_phone_required' }, 409);
    const id = p?.id ?? crypto.randomUUID(),
      now = Date.now();
    const inserted = p
      ? await c.env.DB.prepare(
          "UPDATE practice_groups SET status='creating' WHERE id=? AND status='failed'",
        )
          .bind(p.id)
          .run()
      : await c.env.DB.prepare(
          'INSERT OR IGNORE INTO practice_groups(id,owner_id,subject,created_at) VALUES(?,?,?,?)',
        )
          .bind(id, c.get('owner'), `TT Übung ${id.slice(0, 8)}`, now)
          .run();
    if (!inserted.meta.changes) return c.json({ ok: true });
    p = (await ownGroup(c.env.DB, c.get('owner')))!;
    try {
      const group = await evolution(c.env).createGroup(p.subject, phone.split('@')[0]);
      await c.env.DB.prepare(
        "UPDATE practice_groups SET group_jid=?,status='ready' WHERE id=? AND status='creating'",
      )
        .bind(group.id, id)
        .run();
    } catch (error) {
      await c.env.DB.prepare("UPDATE practice_groups SET status=? WHERE id=? AND status='creating'")
        .bind(
          error instanceof TransportError && error.kind !== 'ambiguous' ? 'failed' : 'uncertain',
          id,
        )
        .run();
    }
    return c.json({ ok: true });
  });
  router.post('/reconcile', async (c) => {
    const p = await ownGroup(c.env.DB, c.get('owner'));
    if (!p) return c.json({ error: 'group_unavailable' }, 409);
    const groups = await evolution(c.env).fetchGroups();
    const matches = groups.filter(
      (g) => g.subject === p.subject && (!p.group_jid || p.group_jid === g.id),
    );
    if (matches.length !== 1) return c.json({ error: 'practice_unconfirmed' }, 409);
    await c.env.DB.prepare("UPDATE practice_groups SET group_jid=?,status='ready' WHERE id=?")
      .bind(matches[0].id, p.id)
      .run();
    return c.json({ ok: true });
  });
  router.post('/invite-link', async (c) => {
    const p = await ownGroup(c.env.DB, c.get('owner'));
    if (!p || p.status !== 'ready' || !p.group_jid)
      return c.json({ error: 'group_unavailable' }, 409);
    try {
      const url = await evolution(c.env).groupInviteLink(p.group_jid);
      if (
        !(await c.env.DB.prepare('SELECT 1 FROM roles WHERE user_id=?')
          .bind(c.get('owner'))
          .first())
      )
        return c.json({ error: 'forbidden' }, 403);
      return c.json({ url });
    } catch {
      return c.json({ error: 'practice_invite_unavailable' }, 502);
    }
  });
  router.post('/action', async (c) => {
    const input = z
      .object({
        action: z.enum(['start', 'late', 'move', 'cancel', 'stop']),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'invalid_input' }, 400);
    const p = await ownGroup(c.env.DB, c.get('owner')),
      now = Date.now();
    if (!p || p.status !== 'ready' || !p.group_jid)
      return c.json({ error: 'group_unavailable' }, 409);
    const { action, version } = input.data;
    if (
      version !== p.version ||
      (action !== 'start' && (p.phase !== 'active' || p.expires_at <= now))
    )
      return c.json({ error: 'state_changed' }, 409);
    if (
      action === 'late' &&
      (await c.env.DB.prepare('SELECT 1 FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`practice:${p.id}:${p.version}:late`)
        .first())
    )
      return c.json({ ok: true });
    const next = {
      ...p,
      version: p.version + (action === 'late' ? 0 : 1),
      started_at: action === 'late' ? p.started_at : Math.floor(now / 1000) * 1000,
      expires_at: action === 'late' ? p.expires_at : now + duration,
      phase: action === 'cancel' ? 'cancelled' : action === 'stop' ? 'stopped' : 'active',
    };
    // Atomic compare-and-swap, invalidation and delivery. The checked update is
    // the transaction guard, so concurrent buttons cannot send two invitations.
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO command_receipts(event_id,user_id,created_at,guard) VALUES(?,?,?,CASE WHEN EXISTS(SELECT 1 FROM practice_groups WHERE id=? AND version=? AND owner_id=? AND EXISTS(SELECT 1 FROM roles WHERE user_id=practice_groups.owner_id)) THEN 1 ELSE 0 END)`,
      ).bind(crypto.randomUUID(), c.get('owner'), now, p.id, p.version, c.get('owner')),
      c.env.DB.prepare(
        'UPDATE practice_groups SET version=?,phase=?,expires_at=?,started_at=? WHERE id=?',
      ).bind(next.version, next.phase, next.expires_at, next.started_at, p.id),
    ];
    if (action !== 'late')
      statements.push(
        c.env.DB.prepare(
          "UPDATE outbox_jobs SET status='cancelled' WHERE practice_id=? AND status IN ('pending','processing')",
        ).bind(p.id),
      );
    // A lateness prompt continues the same replies; a moved/new training starts fresh.

    if (action === 'start' || action === 'move')
      statements.push(
        job(c.env.DB, next, action, 'practice_invite', invitation(action === 'move'), now),
      );
    else
      statements.push(
        job(
          c.env.DB,
          next,
          action,
          action === 'late' ? 'practice_late' : 'practice_end',
          `${intro}\n${action === 'late' ? 'Das Übungstraining beginnt gleich. Reagiere mit ⏰ oder schreibe „Ich komme zehn Minuten später“.' : action === 'cancel' ? 'Der Übungstermin wurde abgesagt. Unter Mehr → Übungsgruppe kannst du neu starten.' : 'Die Übung ist beendet. Vielen Dank fürs Ausprobieren!'}`,
          now,
        ),
      );
    statements.push(
      c.env.DB.prepare(
        "DELETE FROM practice_attendance WHERE group_id=? AND (version!=? OR ?!='active')",
      ).bind(p.id, next.version, next.phase),
    );
    try {
      await c.env.DB.batch(statements);
    } catch {
      return c.json({ error: 'state_changed' }, 409);
    }
    return c.json({ ok: true });
  });
  router.post('/preview', async (c) => {
    const input = z
      .object({
        text: z.string().min(1).max(1000),
        context: z.enum(['none', 'reply', 'yes', 'no']),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'invalid_input' }, 400);
    return c.json(
      attendanceIntent(input.data.text, { hasTrainingContext: input.data.context !== 'none' }),
    );
  });
  app.route('/api/v1/trainer/practice', router);
}

/** The same German parser and provenance-aware reducer as real training,
 * with separate persistence and no production user/membership creation. */
export async function processPracticeMessage(
  env: Env,
  event: MessageEvent,
  now: number,
): Promise<boolean> {
  if (!event.isGroup) return false;
  const p = await env.DB.prepare('SELECT * FROM practice_groups WHERE group_jid=?')
    .bind(event.chatJid)
    .first<Practice>();
  if (!p) return false;
  if (
    p.phase !== 'active' ||
    p.expires_at <= now ||
    event.timestamp < p.started_at ||
    p.status !== 'ready' ||
    !(await env.DB.prepare('SELECT 1 FROM roles WHERE user_id=?').bind(p.owner_id).first())
  )
    return true;
  const target = event.reaction?.targetId ?? event.quotedId;
  let targetKind: string | undefined;
  if (target) {
    const row = await env.DB.prepare(
      "SELECT kind FROM outbox_jobs WHERE practice_id=? AND practice_version=? AND provider_id=? AND status='sent' AND kind IN ('practice_invite','practice_late')",
    )
      .bind(p.id, p.version, target)
      .first<{ kind: string }>();
    if (!row) return true;
    targetKind = row.kind;
  }
  const statistics = !event.reaction && parseStatisticsRequest(event.text ?? '');
  if (statistics) {
    if (
      await env.DB.prepare('SELECT 1 FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`practice:${p.id}:${p.version}:${event.id}`)
        .first()
    )
      return true;
    const months = statistics.months[0];
    const url = await createStatisticsLink(
      env.DB,
      {
        group_jid: null,
        requester_id: null,
        practice_id: p.id,
        practice_version: p.version,
        months,
        expires_at: p.expires_at,
      },
      now,
    );
    const text = compactStatistics(demoStatistics(months), months, { demo: true, url });
    await job(env.DB, p, event.id, 'practice_reply', text, now).run();
    return true;
  }
  for (let retry = 0; retry < 4; retry++) {
    const old = await env.DB.prepare(
      'SELECT state,revision FROM practice_attendance WHERE group_id=? AND version=? AND sender_jid=?',
    )
      .bind(p.id, p.version, event.senderJid)
      .first<{ state: string; revision: number }>();
    const before: AttendanceState = old ? JSON.parse(old.state) : emptyAttendance();
    const change: AttendanceChange = {
      id: event.id,
      timestamp: event.timestamp,
      source: event.reaction ? 'reaction' : 'private',
      ...(target ? { targetId: target } : {}),
    };
    if (event.reaction) {
      const emoji = normalizeEmoji(event.reaction.emoji);
      if (emoji === '👍') {
        change.attendance = 'yes';
        change.clearOwnLateness = true;
      } else if (emoji === '👎') change.attendance = 'no';
      else if (emoji === '⏰') {
        change.attendance = 'yes';
        change.late = true;
      } else if (emoji === '') {
        change.remove = true;
        change.removeLatenessOnly = targetKind === 'practice_late';
      } else return true;
    } else {
      const stamp = before.attendanceStamp;
      const intent = attendanceIntent(event.text ?? '', {
        hasTrainingContext:
          !!target ||
          !!(
            stamp &&
            before.attendance !== 'unknown' &&
            stamp.timestamp < event.timestamp &&
            stamp.timestamp >= now - 86400000
          ),
      });
      if (intent.kind === 'none') return true;
      if (intent.kind === 'uncertain' || intent.day || intent.reference || intent.arrivalTime) {
        await job(
          env.DB,
          p,
          event.id,
          'practice_reply',
          `${intro}\nBitte antworte für diese Übung eindeutig: „Ich komme“, „Kann nicht“ oder „Ich komme später“.`,
          now,
        ).run();
        return true;
      }
      change.attendance = intent.kind === 'no' ? 'no' : 'yes';
      if (intent.kind === 'late' || intent.kind === 'punctual') {
        change.late = intent.kind === 'late';
        change.minutes = intent.minutes;
      }
    }
    const after = reduceAttendance(before, change);
    if (JSON.stringify(after) === JSON.stringify(before)) return true;
    const mutation = env.DB.prepare(
      `INSERT INTO practice_attendance(group_id,version,sender_jid,display_name,state,revision)
      SELECT ?,?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM practice_groups WHERE id=? AND version=? AND phase='active' AND expires_at>?)
      ON CONFLICT(group_id,version,sender_jid) DO UPDATE SET display_name=excluded.display_name,state=excluded.state,revision=practice_attendance.revision+1 WHERE practice_attendance.revision=?`,
    ).bind(
      p.id,
      p.version,
      event.senderJid,
      event.displayName.slice(0, 100),
      JSON.stringify(after),
      p.id,
      p.version,
      now,
      old?.revision ?? 0,
    );
    const statements = [mutation];
    if (!event.reaction)
      statements.push(
        job(
          env.DB,
          p,
          event.id,
          'practice_reply',
          `${intro}\n${event.displayName.slice(0, 100) || 'Deine Rückmeldung'}: ${after.attendance === 'no' ? 'Absage eingetragen.' : after.late ? `Du kommst später${after.minutes ? ` (ca. ${after.minutes} Minuten)` : ''}.` : 'Du bist dabei.'}`,
          now,
          { sender: event.senderJid, value: JSON.stringify(after) },
        ),
      );
    const saved = await env.DB.batch(statements);
    if (!saved[0].meta.changes) continue;
    return true;
  }
  throw new Error('practice_state_changed');
}
