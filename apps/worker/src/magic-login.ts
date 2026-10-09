import type { Context, Hono } from 'hono';
import type { AppBindings, BotContext, User } from './types';
import { all, setting } from './db';
import { consumeRateLimit, hashToken, randomToken } from './security';
import { cookie, cookieHeader, getRole, getSession, SESSION_COOKIE } from './auth';

const LINK_TTL = 10 * 60_000,
  SESSION_TTL = 7 * 86400000,
  FRESH_TTL = 15 * 60_000;
const MAGIC_TOKEN = /^[a-f0-9]{48}$/;
type Ctx = Context<AppBindings>;
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type MagicRow = {
  token_hash: string;
  user_id: string;
  expires_at: number;
  state: string;
  display_name: string;
  jid: string;
  registered_at: number | null;
};
const userView = (u: User) => ({
  id: u.id,
  displayName: u.display_name,
  registeredAt: u.registered_at,
  reminders: !!u.reminders,
});
const hint = (jid: string) => `…${jid.split('@')[0].slice(-4)}`;
const validObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
async function body(c: Ctx): Promise<Record<string, unknown> | null> {
  const value: unknown = await c.req.json().catch(() => null);
  return validObject(value) ? value : null;
}
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((k) => keys.includes(k));

/** The outgoing reply is the only transient plaintext copy required for delivery.
 * Link authentication records contain digests only; root outbox clears sent replies. */
export async function issueMagicLogin(ctx: BotContext): Promise<string[]> {
  if (ctx.isGroup) return ['Bitte fordere deinen Anmeldelink im privaten Botchat an.'];
  const db = ctx.env.DB;
  if (await db.prepare('SELECT 1 FROM auth_magic_links WHERE event_id=?').bind(ctx.eventId).first())
    return [];
  if (!(await consumeRateLimit(db, `magic:issue:${ctx.user.id}`, 5, 10 * 60_000, ctx.now)))
    return ['Du hast mehrere Anmeldelinks angefordert. Bitte warte zehn Minuten.'];
  const newer = await db
    .prepare('SELECT 1 FROM auth_magic_links WHERE user_id=? AND requested_at>=?')
    .bind(ctx.user.id, ctx.timestamp)
    .first();
  if (newer)
    return [
      'Ein neuerer Anmeldelink wurde bereits angefordert. Bitte verwende die letzte Nachricht.',
    ];
  const token = randomToken(24),
    tokenHash = await hashToken(token);
  const message = `Dein Anmeldelink:\n${ctx.origin}/login#${token}\n\nEinmalig, zehn Minuten gültig. Nicht weiterleiten – der Link ermöglicht die Anmeldung.`;
  const results = await db.batch([
    db
      .prepare(
        "UPDATE auth_magic_links SET state='revoked' WHERE user_id=? AND state='pending' AND requested_at<=?",
      )
      .bind(ctx.user.id, ctx.timestamp),
    db
      .prepare(
        `INSERT INTO auth_magic_links(token_hash,user_id,event_id,requested_at,created_at,expires_at)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM auth_magic_links WHERE user_id=? AND requested_at>=?)`,
      )
      .bind(
        tokenHash,
        ctx.user.id,
        ctx.eventId,
        ctx.timestamp,
        ctx.now,
        ctx.now + LINK_TTL,
        ctx.user.id,
        ctx.timestamp,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at)
      SELECT ?,?,?,?,'reply',?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_magic_links WHERE token_hash=? AND state='pending')`,
      )
      .bind(
        crypto.randomUUID(),
        `reply:${ctx.eventId}:0`,
        ctx.chatJid,
        ctx.user.id,
        message,
        ctx.now,
        ctx.now + LINK_TTL,
        ctx.now,
        tokenHash,
      ),
  ]);
  return results[1].meta.changes === 1
    ? [message]
    : ['Bitte verwende den zuletzt angeforderten Anmeldelink.'];
}

async function magicRow(c: Ctx, raw: unknown): Promise<MagicRow | null> {
  if (typeof raw !== 'string' || !MAGIC_TOKEN.test(raw)) return null;
  return c.env.DB.prepare(
    `SELECT l.token_hash,l.user_id,l.expires_at,l.state,u.display_name,u.jid,u.registered_at
    FROM auth_magic_links l JOIN users u ON u.id=l.user_id WHERE l.token_hash=? AND l.state='pending' AND l.expires_at>?`,
  )
    .bind(await hashToken(raw), Date.now())
    .first<MagicRow>();
}
async function signedIn(c: Ctx, fresh = false, owner = false): Promise<Session | Response> {
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (owner && session.role !== 'owner') return c.json({ error: 'forbidden' }, 403);
  if (fresh && Date.now() - session.authenticatedAt >= FRESH_TTL)
    return c.json({ error: 'reauthentication_required' }, 403);
  if (
    !['GET', 'HEAD'].includes(c.req.method) &&
    !(await consumeRateLimit(c.env.DB, `account:web:${session.user.id}`, 30, 60_000, Date.now()))
  )
    return c.json({ error: 'rate_limit' }, 429);
  return session;
}
async function guard(
  c: Ctx,
  session: Session,
  eventId: string,
  now: number,
  extra = '1',
  params: (string | number)[] = [],
  fresh = false,
): Promise<D1PreparedStatement> {
  const tokenHash = await hashToken(cookie(c.req.raw, SESSION_COOKIE)!);
  return c.env.DB.prepare(
    `INSERT INTO auth_receipts(event_id,created_at,claim) VALUES(?,?,
    EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>? ${fresh ? 'AND authenticated_at>?' : ''}) AND (${extra}))`,
  ).bind(
    eventId,
    now,
    tokenHash,
    session.user.id,
    now,
    ...(fresh ? [now - FRESH_TTL] : []),
    ...params,
  );
}
function audit(
  db: D1Database,
  userId: string,
  action: string,
  detail: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit_log(id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, action, detail, now);
}
async function accountResult(c: Ctx, id: string): Promise<Response> {
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<User>();
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ ok: true, user: userView(user), role: await getRole(c.env.DB, id) });
}

export function registerMagicAndAccountRoutes(app: Hono<AppBindings>): void {
  // These routes are also safe when registered in an isolated Hono application.
  for (const path of ['/api/v1/account/*', '/api/v1/trainer/admins', '/api/v1/trainer/admins/*'])
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(c.req.method)) {
        const origin = await setting(c.env.DB, 'origin', 'https://tt.bz3.eu');
        if (c.req.header('Origin') !== origin || new URL(c.req.url).origin !== origin)
          return c.json({ error: 'origin' }, 403);
      }
      await next();
    });
  app.post('/api/v1/auth/magic/preview', async (c) => {
    const value = await body(c);
    if (!value || !only(value, ['token'])) return c.json({ error: 'invalid_input' }, 400);
    const ip = await hashToken(c.req.header('CF-Connecting-IP') ?? 'unknown');
    if (!(await consumeRateLimit(c.env.DB, `magic:preview:${ip}`, 60, 10 * 60_000, Date.now())))
      return c.json({ error: 'rate_limit' }, 429);
    const row = await magicRow(c, value.token);
    if (!row) return c.json({ error: 'invalid_link' }, 401);
    const role = await getRole(c.env.DB, row.user_id);
    return c.json({
      status: 'ready',
      displayName: row.display_name,
      accountHint: hint(row.jid),
      role,
      registrationRequired: row.registered_at === null && !role,
      privacyReady: (await setting(c.env.DB, 'privacy_ready')) === '1',
      expiresAt: row.expires_at,
    });
  });
  app.post('/api/v1/auth/magic/finish', async (c) => {
    const value = await body(c);
    if (
      !value ||
      !only(value, ['token', 'consent']) ||
      (value.consent !== undefined && value.consent !== true)
    )
      return c.json({ error: 'invalid_input' }, 400);
    const now = Date.now(),
      ip = await hashToken(c.req.header('CF-Connecting-IP') ?? 'unknown');
    if (!(await consumeRateLimit(c.env.DB, `magic:finish:${ip}`, 30, 10 * 60_000, now)))
      return c.json({ error: 'rate_limit' }, 429);
    const row = await magicRow(c, value.token);
    if (!row) return c.json({ error: 'invalid_link' }, 401);
    const role = await getRole(c.env.DB, row.user_id),
      privacy = (await setting(c.env.DB, 'privacy_ready')) === '1';
    if (!role && row.registered_at === null) {
      if (!privacy) return c.json({ error: 'not_ready' }, 503);
      if (value.consent !== true)
        return c.json({ error: 'registration_required', privacyUrl: '/datenschutz' }, 409);
    }
    const token = randomToken(),
      sessionHash = await hashToken(token),
      prior = cookie(c.req.raw, SESSION_COOKIE);
    const statements = [
      c.env.DB.prepare(
        `UPDATE auth_magic_links SET state='used',exchange_hash=?,registered_on_exchange=
        CASE WHEN ?=1 AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1') AND EXISTS(SELECT 1 FROM users WHERE id=auth_magic_links.user_id AND registered_at IS NULL) THEN 1 ELSE 0 END
        WHERE token_hash=? AND state='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM users u WHERE u.id=auth_magic_links.user_id AND
        (u.registered_at IS NOT NULL OR EXISTS(SELECT 1 FROM roles WHERE user_id=u.id) OR (?=1 AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1'))))`,
      ).bind(
        sessionHash,
        value.consent === true ? 1 : 0,
        row.token_hash,
        now,
        value.consent === true ? 1 : 0,
      ),
      c.env.DB.prepare(
        `UPDATE users SET registered_at=? WHERE id IN(SELECT user_id FROM auth_magic_links WHERE exchange_hash=? AND registered_on_exchange=1) AND registered_at IS NULL`,
      ).bind(now, sessionHash),
      c.env.DB.prepare(
        `INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at)
        SELECT ?,user_id,'registration','1',1,?,? FROM auth_magic_links WHERE exchange_hash=? AND registered_on_exchange=1`,
      ).bind(crypto.randomUUID(), `magic-register:${sessionHash}`, now, sessionHash),
      c.env.DB.prepare(
        `INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at,last_seen_at)
        SELECT exchange_hash,user_id,?,?,? FROM auth_magic_links WHERE exchange_hash=? AND state='used'`,
      ).bind(now, now + SESSION_TTL, now, sessionHash),
    ];
    if (prior)
      statements.push(
        c.env.DB.prepare(
          'DELETE FROM auth_sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=?)',
        ).bind(await hashToken(prior), sessionHash),
      );
    const results = await c.env.DB.batch(statements);
    if (results[3].meta.changes !== 1) return c.json({ error: 'invalid_link' }, 401);
    const currentRole = await getRole(c.env.DB, row.user_id);
    c.header('Set-Cookie', cookieHeader(SESSION_COOKIE, token, SESSION_TTL / 1000), {
      append: true,
    });
    return c.json({ ok: true, role: currentRole, redirect: currentRole ? '/trainer' : '/konto' });
  });
  app.post('/api/v1/account/register', async (c) => {
    const session = await signedIn(c);
    if (session instanceof Response) return session;
    const value = await body(c);
    if (!value || !only(value, ['consent']) || value.consent !== true)
      return c.json({ error: 'consent_required' }, 400);
    if ((await setting(c.env.DB, 'privacy_ready')) !== '1')
      return c.json({ error: 'not_ready' }, 503);
    if (session.user.registered_at !== null) return accountResult(c, session.user.id);
    const now = Date.now(),
      eventId = `web:${crypto.randomUUID()}`;
    await c.env.DB.batch([
      await guard(
        c,
        session,
        eventId,
        now,
        "EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')",
      ),
      c.env.DB.prepare(
        "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) SELECT ?,?,'registration','1',1,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND registered_at IS NULL)",
      ).bind(crypto.randomUUID(), session.user.id, eventId, now, session.user.id),
      c.env.DB.prepare('UPDATE users SET registered_at=COALESCE(registered_at,?) WHERE id=?').bind(
        now,
        session.user.id,
      ),
    ]);
    return accountResult(c, session.user.id);
  });
  app.patch('/api/v1/account/preferences', async (c) => {
    const session = await signedIn(c);
    if (session instanceof Response) return session;
    const value = await body(c);
    if (
      !value ||
      !only(value, ['displayName', 'reminders', 'reminderConsent']) ||
      (!('displayName' in value) && !('reminders' in value)) ||
      ('displayName' in value &&
        (typeof value.displayName !== 'string' ||
          !value.displayName.trim() ||
          value.displayName.trim().length > 80)) ||
      ('reminders' in value && typeof value.reminders !== 'boolean') ||
      ('reminderConsent' in value && value.reminderConsent !== true)
    )
      return c.json({ error: 'invalid_input' }, 400);
    const reminderChange =
      typeof value.reminders === 'boolean' && value.reminders !== !!session.user.reminders;
    if (
      value.reminders === true &&
      (session.user.registered_at === null || (reminderChange && value.reminderConsent !== true))
    )
      return c.json(
        {
          error: session.user.registered_at === null ? 'registration_required' : 'consent_required',
        },
        409,
      );
    if (value.reminders === true && (await setting(c.env.DB, 'privacy_ready')) !== '1')
      return c.json({ error: 'not_ready' }, 503);
    const db = c.env.DB,
      now = Date.now(),
      eventId = `web:${crypto.randomUUID()}`;
    const statements = [
      await guard(
        c,
        session,
        eventId,
        now,
        value.reminders === true
          ? "EXISTS(SELECT 1 FROM users WHERE id=? AND registered_at IS NOT NULL) AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')"
          : '1',
        value.reminders === true ? [session.user.id] : [],
      ),
    ];
    if (typeof value.displayName === 'string')
      statements.push(
        db
          .prepare('UPDATE users SET display_name=? WHERE id=?')
          .bind(value.displayName.trim(), session.user.id),
      );
    if (reminderChange) {
      statements.push(
        db
          .prepare(
            'UPDATE users SET reminders=?,reminders_updated_at=MAX(reminders_updated_at+1,?) WHERE id=?',
          )
          .bind(value.reminders ? 1 : 0, now, session.user.id),
        db
          .prepare(
            "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES(?,?,'reminders','1',?,?,?)",
          )
          .bind(crypto.randomUUID(), session.user.id, value.reminders ? 1 : 0, eventId, now),
        db
          .prepare("DELETE FROM conversations WHERE user_id=? AND kind='auth:reminders'")
          .bind(session.user.id),
      );
      if (!value.reminders)
        statements.push(
          db
            .prepare(
              "UPDATE outbox_jobs SET status='cancelled',lease_until=NULL WHERE user_id=? AND kind LIKE 'personal_%' AND status IN ('pending','processing','retry','leased')",
            )
            .bind(session.user.id),
        );
    }
    await db.batch(statements);
    return accountResult(c, session.user.id);
  });
  app.get('/api/v1/account/data', async (c) => {
    const session = await signedIn(c);
    if (session instanceof Response) return session;
    const db = c.env.DB,
      id = session.user.id;
    const [aliases, memberships, attendance, consents] = await Promise.all([
      all(db, 'SELECT jid FROM identity_aliases WHERE user_id=?', id),
      all(db, 'SELECT group_jid,active,updated_at FROM memberships WHERE user_id=?', id),
      all(
        db,
        'SELECT session_id,response,punctuality,minutes,arrival_time,updated_at FROM attendance WHERE user_id=?',
        id,
      ),
      all(db, 'SELECT purpose,version,accepted,created_at FROM consents WHERE user_id=?', id),
    ]);
    return c.json({
      account: userView(session.user),
      role: session.role,
      aliases,
      memberships,
      attendance,
      consents,
    });
  });
  app.post('/api/v1/account/delete', async (c) => {
    const session = await signedIn(c);
    if (session instanceof Response) return session;
    const value = await body(c);
    if (!value || !only(value, ['confirm']) || value.confirm !== 'DELETE')
      return c.json({ error: 'confirmation_required' }, 400);
    if (session.role === 'owner') return c.json({ error: 'owner_transfer_required' }, 409);
    const db = c.env.DB,
      now = Date.now();
    await db.batch([
      await guard(
        c,
        session,
        `web:${crypto.randomUUID()}`,
        now,
        "NOT EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')",
        [session.user.id],
      ),
      audit(db, session.user.id, 'account.deleted', '', now),
      db.prepare('DELETE FROM users WHERE id=?').bind(session.user.id),
    ]);
    c.header('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0), { append: true });
    return c.json({ ok: true });
  });
  app.get('/api/v1/trainer/admins', async (c) => {
    const session = await signedIn(c, false, true);
    if (session instanceof Response) return session;
    const rows = await all<User & { role: 'owner' | 'admin' | null }>(
      c.env.DB,
      `SELECT u.*,r.role FROM users u LEFT JOIN roles r ON r.user_id=u.id WHERE r.role IS NOT NULL OR (u.registered_at IS NOT NULL AND EXISTS(SELECT 1 FROM identity_aliases WHERE user_id=u.id)) ORDER BY u.display_name,u.id`,
    );
    const pendingTransfer = await c.env.DB.prepare(
      "SELECT t.id,t.candidate_id AS candidateId,u.display_name AS candidateName,t.expires_at AS expiresAt FROM owner_transfers t JOIN users u ON u.id=t.candidate_id WHERE t.owner_id=? AND t.state='pending' AND t.expires_at>? ORDER BY t.created_at DESC LIMIT 1",
    )
      .bind(session.user.id, Date.now())
      .first();
    return c.json({
      admins: rows
        .filter((u) => u.role)
        .map((u) => ({
          id: u.id,
          displayName: u.display_name,
          accountHint: hint(u.jid),
          role: u.role,
        })),
      eligible: rows
        .filter((u) => u.registered_at !== null && u.id !== session.user.id)
        .map((u) => ({ id: u.id, displayName: u.display_name, accountHint: hint(u.jid) })),
      pendingTransfer,
    });
  });
  app.post('/api/v1/trainer/admins', async (c) => {
    const session = await signedIn(c, true, true);
    if (session instanceof Response) return session;
    const value = await body(c);
    if (
      !value ||
      !only(value, ['userId', 'role', 'confirm']) ||
      typeof value.userId !== 'string' ||
      value.role !== 'admin' ||
      value.confirm !== true
    )
      return c.json({ error: 'invalid_input' }, 400);
    const target = await c.env.DB.prepare(
      'SELECT id FROM users WHERE id=? AND registered_at IS NOT NULL AND EXISTS(SELECT 1 FROM identity_aliases WHERE user_id=users.id)',
    )
      .bind(value.userId)
      .first();
    if (!target) return c.json({ error: 'not_found' }, 404);
    if ((await getRole(c.env.DB, value.userId)) === 'owner')
      return c.json({ error: 'owner_transfer_required' }, 409);
    const db = c.env.DB,
      now = Date.now();
    await db.batch([
      await guard(
        c,
        session,
        `web:${crypto.randomUUID()}`,
        now,
        "EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner') AND EXISTS(SELECT 1 FROM users WHERE id=? AND registered_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')",
        [session.user.id, value.userId, value.userId],
        true,
      ),
      db
        .prepare(
          "INSERT INTO roles(user_id,role,created_at) VALUES(?,'admin',?) ON CONFLICT(user_id) DO NOTHING",
        )
        .bind(value.userId, now),
      audit(db, session.user.id, 'admin.granted', value.userId, now),
    ]);
    return c.json({ ok: true });
  });
  app.delete('/api/v1/trainer/admins/:id', async (c) => {
    const session = await signedIn(c, true, true);
    if (session instanceof Response) return session;
    const value = await body(c);
    if (!value || !only(value, ['confirm']) || value.confirm !== true)
      return c.json({ error: 'confirmation_required' }, 400);
    const target = c.req.param('id'),
      role = await getRole(c.env.DB, target);
    if (role === 'owner') return c.json({ error: 'owner_transfer_required' }, 409);
    if (!role) return c.json({ error: 'not_found' }, 404);
    const db = c.env.DB,
      now = Date.now();
    await db.batch([
      await guard(
        c,
        session,
        `web:${crypto.randomUUID()}`,
        now,
        "EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner') AND EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='admin')",
        [session.user.id, target],
        true,
      ),
      db.prepare("DELETE FROM roles WHERE user_id=? AND role='admin'").bind(target),
      audit(db, session.user.id, 'admin.removed', target, now),
    ]);
    return c.json({ ok: true });
  });
  app.post('/api/v1/trainer/admins/transfer', async (c) => {
    const session = await signedIn(c, true, true);
    if (session instanceof Response) return session;
    const value = await body(c);
    if (
      !value ||
      !only(value, ['userId', 'confirm']) ||
      typeof value.userId !== 'string' ||
      value.userId === session.user.id ||
      value.confirm !== true
    )
      return c.json({ error: 'invalid_input' }, 400);
    if (
      !(await c.env.DB.prepare(
        'SELECT id FROM users WHERE id=? AND registered_at IS NOT NULL AND EXISTS(SELECT 1 FROM identity_aliases WHERE user_id=users.id)',
      )
        .bind(value.userId)
        .first())
    )
      return c.json({ error: 'not_found' }, 404);
    const db = c.env.DB,
      now = Date.now();
    await db.batch([
      await guard(
        c,
        session,
        `web:${crypto.randomUUID()}`,
        now,
        "EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner') AND EXISTS(SELECT 1 FROM users WHERE id=? AND registered_at IS NOT NULL)",
        [session.user.id, value.userId],
        true,
      ),
      db
        .prepare("UPDATE owner_transfers SET state='revoked' WHERE owner_id=? AND state='pending'")
        .bind(session.user.id),
      db
        .prepare(
          'INSERT INTO owner_transfers(id,owner_id,candidate_id,created_at,expires_at) VALUES(?,?,?,?,?)',
        )
        .bind(crypto.randomUUID(), session.user.id, value.userId, now, now + 86400000),
      audit(db, session.user.id, 'owner.transfer_requested', value.userId, now),
    ]);
    return c.json({ ok: true, pending: true });
  });
  app.get('/api/v1/account/owner-transfer', async (c) => {
    const session = await signedIn(c);
    if (session instanceof Response) return session;
    const transfer = await c.env.DB.prepare(
      "SELECT t.id,u.display_name AS ownerName,t.expires_at AS expiresAt FROM owner_transfers t JOIN users u ON u.id=t.owner_id JOIN roles r ON r.user_id=t.owner_id AND r.role='owner' WHERE t.candidate_id=? AND t.state='pending' AND t.expires_at>? ORDER BY t.created_at DESC LIMIT 1",
    )
      .bind(session.user.id, Date.now())
      .first();
    return c.json({ transfer });
  });
  for (const action of ['accept', 'reject'])
    app.post(`/api/v1/account/owner-transfer/:id/${action}`, async (c) => {
      const session = await signedIn(c, action === 'accept');
      if (session instanceof Response) return session;
      const value = await body(c);
      if (!value || !only(value, ['confirm']) || value.confirm !== true)
        return c.json({ error: 'confirmation_required' }, 400);
      const db = c.env.DB,
        now = Date.now(),
        id = c.req.param('id');
      const transfer = await db
        .prepare(
          "SELECT owner_id FROM owner_transfers WHERE id=? AND candidate_id=? AND state='pending' AND expires_at>?",
        )
        .bind(id, session.user.id, now)
        .first<{ owner_id: string }>();
      if (!transfer) return c.json({ error: 'not_found' }, 404);
      const statements = [
        await guard(
          c,
          session,
          `web:${crypto.randomUUID()}`,
          now,
          "EXISTS(SELECT 1 FROM owner_transfers t JOIN roles r ON r.user_id=t.owner_id AND r.role='owner' WHERE t.id=? AND t.candidate_id=? AND t.state='pending' AND t.expires_at>?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND registered_at IS NOT NULL)",
          [id, session.user.id, now, session.user.id],
          action === 'accept',
        ),
      ];
      if (action === 'accept')
        statements.push(
          db
            .prepare(
              "INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?) ON CONFLICT(user_id) DO UPDATE SET role='owner'",
            )
            .bind(session.user.id, now),
          db
            .prepare("UPDATE roles SET role='admin' WHERE user_id=? AND role='owner'")
            .bind(transfer.owner_id),
          audit(db, session.user.id, 'owner.transferred', transfer.owner_id, now),
        );
      statements.push(
        db
          .prepare('UPDATE owner_transfers SET state=? WHERE id=?')
          .bind(action === 'accept' ? 'accepted' : 'rejected', id),
      );
      await db.batch(statements);
      return action === 'accept'
        ? c.json({ ok: true, role: 'owner', redirect: '/trainer' })
        : c.json({ ok: true });
    });
}
