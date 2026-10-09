import { Hono } from 'hono';
import { z } from 'zod';
import type { EvolutionClient, EvolutionGroup } from '@tt/whatsapp';
import { getSession, resolveUser } from './auth';
import { all, setting } from './db';
import { evolution, queue } from './outbox';
import { hashToken, consumeRateLimit } from './security';
import type { AppBindings, Env } from './types';

interface RequestRow {
  id: string;
  requester_id: string | null;
  source: 'link' | 'membership';
  invite_code: string | null;
  group_jid: string;
  subject: string;
  status: 'pending' | 'joining' | 'approved' | 'rejected' | 'uncertain';
  created_at: number;
  updated_at: number;
  expires_at: number;
  error: string | null;
}
class GroupRequestError extends Error {}
type Trainer = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export function inviteCode(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'chat.whatsapp.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    const code = url.pathname.slice(1);
    return /^[a-zA-Z0-9_-]{20,64}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

async function notifyTrainers(
  env: Env,
  id: string,
  now: number,
  requesterId?: string,
): Promise<void> {
  const trainers = await all<{ id: string; jid: string }>(
    env.DB,
    'SELECT u.id,u.jid FROM users u JOIN roles r ON r.user_id=u.id',
  );
  const origin = await setting(env.DB, 'origin', 'https://tt.bz3.eu');
  for (const trainer of trainers) {
    if (trainer.id === requesterId) continue;
    await queue(
      env.DB,
      {
        key: `group-request:${id}:${trainer.id}`,
        userId: trainer.id,
        chat: trainer.jid,
        text: `Eine Gruppe wartet auf deine Freigabe. Bitte prüfe sie im Trainerbereich: ${origin}/trainer`,
      },
      now,
    );
  }
}

export async function requestGroupLink(
  env: Env,
  userId: string,
  link: string,
  now = Date.now(),
  client = evolution(env),
): Promise<string> {
  const code = inviteCode(link);
  if (!code) throw new GroupRequestError('invalid_invite');
  if (!(await consumeRateLimit(env.DB, `group-request:${userId}`, 5, 3600000, now)))
    throw new GroupRequestError('rate_limit');
  const fingerprint = await hashToken(`link:${code}`);
  const previous = await env.DB.prepare(
    'SELECT id,status,expires_at FROM group_requests WHERE fingerprint=?',
  )
    .bind(fingerprint)
    .first<{ id: string; status: string; expires_at: number }>();
  const renew = previous?.status === 'pending' && previous.expires_at <= now;
  if (previous && !renew) {
    if (previous.status === 'rejected') throw new GroupRequestError('request_rejected');
    return previous.id;
  }
  const metadata = await client.inviteInfo(code);
  const id = previous?.id ?? crypto.randomUUID();
  if (renew) {
    await env.DB.prepare(
      "UPDATE group_requests SET requester_id=?,invite_code=?,group_jid=?,subject=?,updated_at=?,expires_at=?,error=NULL WHERE id=? AND status='pending' AND expires_at<=?",
    )
      .bind(
        userId,
        code,
        metadata.id,
        metadata.subject.slice(0, 200),
        now,
        now + 7 * 86400000,
        id,
        now,
      )
      .run();
  } else {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO group_requests(id,fingerprint,requester_id,source,invite_code,group_jid,subject,created_at,updated_at,expires_at) VALUES(?,?,?,'link',?,?,?,?,?,?)",
    )
      .bind(
        id,
        fingerprint,
        userId,
        code,
        metadata.id,
        metadata.subject.slice(0, 200),
        now,
        now,
        now + 7 * 86400000,
      )
      .run();
  }
  const saved = await env.DB.prepare('SELECT id FROM group_requests WHERE fingerprint=?')
    .bind(fingerprint)
    .first<{ id: string }>();
  await notifyTrainers(env, saved!.id, now, userId);
  return saved!.id;
}

function containsBot(group: EvolutionGroup, bot: string): boolean {
  return !!bot && group.participants.some((p) => p.id === bot || p.aliases?.includes(bot));
}

export async function observeBotGroup(
  env: Env,
  groupJid: string,
  now = Date.now(),
  client = evolution(env),
): Promise<void> {
  if (
    await env.DB.prepare('SELECT jid FROM groups WHERE jid=? AND active=1').bind(groupJid).first()
  )
    return;
  const fingerprint = await hashToken(`membership:${groupJid}`);
  const previous = await env.DB.prepare(
    'SELECT id,status,expires_at FROM group_requests WHERE fingerprint=?',
  )
    .bind(fingerprint)
    .first<{ id: string; status: string; expires_at: number }>();
  const renew = previous?.status === 'pending' && previous.expires_at <= now;
  if (previous && !renew) return;
  if (!(await consumeRateLimit(env.DB, 'group-discovery', 10, 60000, now))) return;
  const group = (await client.fetchGroups()).find((g) => g.id === groupJid);
  if (!group || !containsBot(group, await setting(env.DB, 'bot_jid'))) return;
  const id = previous?.id ?? crypto.randomUUID();
  const result = renew
    ? await env.DB.prepare(
        "UPDATE group_requests SET subject=?,updated_at=?,expires_at=?,error=NULL WHERE id=? AND status='pending' AND expires_at<=?",
      )
        .bind(group.subject.slice(0, 200), now, now + 7 * 86400000, id, now)
        .run()
    : await env.DB.prepare(
        "INSERT OR IGNORE INTO group_requests(id,fingerprint,source,group_jid,subject,created_at,updated_at,expires_at) VALUES(?,?,'membership',?,?,?,?,?)",
      )
        .bind(id, fingerprint, group.id, group.subject.slice(0, 200), now, now, now + 7 * 86400000)
        .run();
  if (result.meta.changes) await notifyTrainers(env, id, now);
}

async function commitApproval(
  env: Env,
  row: RequestRow,
  trainer: Trainer,
  group: EvolutionGroup,
  now: number,
): Promise<void> {
  if (group.id !== row.group_jid || !containsBot(group, await setting(env.DB, 'bot_jid')))
    throw new GroupRequestError('membership_unconfirmed');
  const display = (value: string, fallback: string) =>
    value
      .replace(/[\p{Cc}\p{Cf}*_~`]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || fallback;
  const botName = display(await setting(env.DB, 'bot_name', 'TT Bot'), 'TT Bot');
  const trainerName = display(trainer.user.display_name, 'Trainerteam');
  const origin = await setting(env.DB, 'origin', 'https://tt.bz3.eu');
  const welcome = `🏓 *Willkommen bei TT*\n\n*${botName}* übernimmt ab jetzt die Trainingsabfragen für *${trainerName}*.\n\n*So meldest du dich zurück*\n👍 Zusage · 👎 Absage – direkt auf die Trainingsabfrage reagieren.\n⏰ Du kommst später? Reagiere auf die Verspätungsabfrage oder nutze den Link darin.\n\nInformationen: ${origin}/info\n\n_Powered by KMUC_`;
  const members: string[] = [];
  for (const p of group.participants) {
    const user = await resolveUser(
      env,
      p.aliases?.[0] ?? p.id,
      p.aliases?.length ? [p.id, ...p.aliases] : [],
      '',
      now,
    );
    if (!user) throw new GroupRequestError('identity_conflict');
    members.push(user.id);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO group_approval_commits(request_id,user_id,claimed,created_at)
      VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM roles WHERE user_id=?) AND EXISTS(SELECT 1 FROM group_requests WHERE id=? AND status='joining' AND updated_at=? AND expires_at>?) THEN 1 ELSE 0 END,?)`,
    ).bind(row.id, trainer.user.id, trainer.user.id, row.id, now, now, now),
    env.DB.prepare(
      'INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?) ON CONFLICT(jid) DO UPDATE SET name=excluded.name,active=1',
    ).bind(group.id, group.subject, now),
    env.DB.prepare(
      'UPDATE memberships SET active=0,updated_at=? WHERE group_jid=? AND updated_at<=?',
    ).bind(now, group.id, now),
    ...members.map((id) =>
      env.DB.prepare(
        'INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?) ON CONFLICT(group_jid,user_id) DO UPDATE SET active=1,updated_at=excluded.updated_at WHERE memberships.updated_at<=excluded.updated_at',
      ).bind(group.id, id, now),
    ),
    env.DB.prepare(
      "UPDATE group_requests SET status='approved',invite_code=NULL,error=NULL,updated_at=? WHERE id=?",
    ).bind(now, row.id),
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,kind,text,due_at,expires_at,created_at) VALUES(?,?,?,'reply',?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      `group-welcome:${group.id}`,
      group.id,
      welcome,
      now,
      now + 86400000,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO settings(key,value) VALUES('selected_group',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value=''",
    ).bind(group.id),
    env.DB.prepare(
      "INSERT INTO audit_log(id,user_id,action,detail,created_at) VALUES(?,?,'group.approved',?,?)",
    ).bind(crypto.randomUUID(), trainer.user.id, row.id, now),
  ]);
}

export async function approveGroupRequest(
  env: Env,
  id: string,
  trainer: Trainer,
  reconcile = false,
  now = Date.now(),
  client = evolution(env),
): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM group_requests WHERE id=?')
    .bind(id)
    .first<RequestRow>();
  if (!row || row.expires_at <= now) throw new GroupRequestError('request_expired');
  if (row.status === 'approved') return;
  const eligible = reconcile
    ? row.status === 'uncertain' || (row.status === 'joining' && row.updated_at < now - 120000)
    : row.status === 'pending';
  if (!eligible) throw new GroupRequestError('request_changed');
  const claim = await env.DB.prepare(
    "UPDATE group_requests SET status='joining',updated_at=? WHERE id=? AND status=? AND updated_at=? AND EXISTS(SELECT 1 FROM roles WHERE user_id=?)",
  )
    .bind(now, id, row.status, row.updated_at, trainer.user.id)
    .run();
  if (!claim.meta.changes) throw new GroupRequestError('request_changed');
  try {
    if (!reconcile && row.source === 'link') {
      if (!row.invite_code) throw new GroupRequestError('invalid_invite');
      const metadata = await client.inviteInfo(row.invite_code);
      if (metadata.id !== row.group_jid) throw new GroupRequestError('invite_changed');
      if ((await client.acceptInvite(row.invite_code)) !== row.group_jid)
        throw new GroupRequestError('invite_changed');
    }
    const group = (await client.fetchGroups()).find((g) => g.id === row.group_jid);
    if (!group) throw new GroupRequestError('membership_unconfirmed');
    await commitApproval(env, row, trainer, group, now);
  } catch (error) {
    await env.DB.prepare(
      "UPDATE group_requests SET status='uncertain',error='approval_unconfirmed',updated_at=? WHERE id=? AND status='joining' AND updated_at=?",
    )
      .bind(now, id, now)
      .run();
    if (error instanceof GroupRequestError) throw error;
    throw new GroupRequestError('approval_unconfirmed');
  }
}

export function registerGroupRequestRoutes(app: Hono<AppBindings>): void {
  const routes = new Hono<{ Bindings: Env; Variables: { trainer: Trainer } }>();
  routes.use('*', async (c, next) => {
    const trainer = await getSession(c.req.raw, c.env);
    if (!trainer) return c.json({ error: 'unauthorized' }, 401);
    if (!trainer.role) return c.json({ error: 'forbidden' }, 403);
    if (
      c.req.method !== 'GET' &&
      (c.req.header('Origin') !== (await setting(c.env.DB, 'origin')) ||
        c.req.header('Sec-Fetch-Site') === 'cross-site')
    )
      return c.json({ error: 'origin_mismatch' }, 403);
    c.set('trainer', trainer);
    await next();
  });
  routes.get('/', async (c) => {
    await c.env.DB.prepare(
      "UPDATE group_requests SET status='uncertain',error='approval_interrupted' WHERE status='joining' AND updated_at<?",
    )
      .bind(Date.now() - 120000)
      .run();
    const rows = await all<RequestRow & { requester_name: string }>(
      c.env.DB,
      'SELECT g.*,u.display_name AS requester_name FROM group_requests g LEFT JOIN users u ON u.id=g.requester_id ORDER BY created_at DESC LIMIT 100',
    );
    return c.json({
      requests: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        groupJid: r.group_jid,
        status: r.status,
        source: r.source,
        requestedAt: r.created_at,
        requesterName: r.requester_name ?? 'WhatsApp',
        error: r.error,
      })),
    });
  });
  routes.post('/', async (c) => {
    const input = z
      .object({ inviteLink: z.string().max(1000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'invalid_input' }, 400);
    try {
      return c.json(
        { request: await requestGroupLink(c.env, c.get('trainer').user.id, input.data.inviteLink) },
        201,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof GroupRequestError ? error.message : 'provider_unavailable' },
        400,
      );
    }
  });
  for (const action of ['approve', 'reconcile', 'reject'] as const)
    routes.post(`/:id/${action}`, async (c) => {
      const input = z
        .object({ confirm: z.literal(true) })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!input.success) return c.json({ error: 'confirmation_required' }, 400);
      const id = c.req.param('id'),
        trainer = c.get('trainer');
      if (action === 'reject') {
        const result = await c.env.DB.prepare(
          "UPDATE group_requests SET status='rejected',invite_code=NULL,updated_at=? WHERE id=? AND status IN ('pending','uncertain') AND EXISTS(SELECT 1 FROM roles WHERE user_id=?)",
        )
          .bind(Date.now(), id, trainer.user.id)
          .run();
        return result.meta.changes
          ? c.json({ ok: true })
          : c.json({ error: 'request_changed' }, 409);
      }
      try {
        await approveGroupRequest(c.env, id, trainer, action === 'reconcile');
        return c.json({ ok: true });
      } catch (error) {
        return c.json(
          { error: error instanceof GroupRequestError ? error.message : 'approval_unconfirmed' },
          409,
        );
      }
    });
  app.route('/api/v1/trainer/group-requests', routes);
}
