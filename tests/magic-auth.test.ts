import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { testDb } from './helpers/db';
import {
  getRole,
  getSession,
  handleAccountMessage,
  registerAuthRoutes,
  resolveUser,
} from '../apps/worker/src/auth';
import { hashToken, randomToken } from '../apps/worker/src/security';
import type { AppBindings, BotContext, Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, app: Hono<AppBindings>, now: number;
const origin = 'https://tt.example.org';
beforeEach(async () => {
  db = testDb();
  now = Date.now();
  env = {
    DB: db,
    ASSETS: {
      fetch: async () => new Response(''),
      connect: () => {
        throw new Error('unused');
      },
    },
    EVOLUTION_URL: 'https://fixture.invalid',
    EVOLUTION_INSTANCE: 'test',
    EVOLUTION_API_KEY: 'fixture',
  };
  app = new Hono<AppBindings>();
  app.onError((_e, c) => c.json({ error: 'internal_error' }, 500));
  registerAuthRoutes(app);
  await db.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'").run();
});
afterEach(() => db.close());
async function user(
  phone = '491234567890',
  registered = false,
  role?: 'admin' | 'owner',
): Promise<User> {
  const u = (await resolveUser(env, `${phone}@s.whatsapp.net`, [], 'Fixture Person', now))!;
  if (registered) {
    await db.prepare('UPDATE users SET registered_at=? WHERE id=?').bind(now, u.id).run();
    u.registered_at = now;
  }
  if (role)
    await db
      .prepare('INSERT INTO roles(user_id,role,created_at) VALUES(?,?,?)')
      .bind(u.id, role, now)
      .run();
  return u;
}
function context(u: User, text = '/login'): BotContext {
  return {
    env,
    user: u,
    text,
    chatJid: u.jid,
    isGroup: false,
    eventId: crypto.randomUUID(),
    timestamp: ++now,
    now,
    origin,
  };
}
async function issue(u: User, text = '/login') {
  const ctx = context(u, text),
    reply = await handleAccountMessage(ctx);
  const token = reply?.join('\n').match(/\/login#([a-f0-9]{48})/)?.[1];
  expect(token).toBeTruthy();
  return { token: token!, ctx, reply };
}
async function req(
  path: string,
  method = 'GET',
  value?: unknown,
  cookies?: string,
  originHeader = origin,
): Promise<Response> {
  return app.request(
    `${origin}${path}`,
    {
      method,
      headers: {
        Origin: originHeader,
        'Content-Type': 'application/json',
        ...(cookies ? { Cookie: cookies } : {}),
      },
      ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    },
    env,
  );
}
async function session(u: User, age = 0): Promise<string> {
  const token = randomToken();
  await db
    .prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)',
    )
    .bind(await hashToken(token), u.id, Date.now() - age, Date.now() + 86400000, Date.now())
    .run();
  return `__Host-tt-session=${token}`;
}
const cookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');

describe('WhatsApp magic links', () => {
  it.each(['/login', 'anmelden', 'Trainerbereich öffnen'])(
    'issues a hash-only single-use link for %s',
    async (text) => {
      const u = await user(),
        link = await issue(u, text);
      const stored = await db.prepare('SELECT * FROM auth_magic_links').first();
      expect(JSON.stringify(stored)).not.toContain(link.token);
      expect(stored).toMatchObject({ user_id: u.id, state: 'pending' });
      expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(0);
      expect(
        await db
          .prepare('SELECT COUNT(*) AS n FROM outbox_jobs WHERE dedupe_key=?')
          .bind(`reply:${link.ctx.eventId}:0`)
          .first('n'),
      ).toBe(1);
      expect(await handleAccountMessage(link.ctx)).toEqual([]);
      expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_magic_links').first('n')).toBe(1);
    },
  );
  it('never issues a link in groups and never consumes through GET or preview', async () => {
    const u = await user();
    await handleAccountMessage({ ...context(u), isGroup: true, chatJid: '120363111111@g.us' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_magic_links').first('n')).toBe(0);
    const link = await issue(u);
    expect((await req('/api/v1/auth/magic/finish')).status).toBe(404);
    const preview = await req('/api/v1/auth/magic/preview', 'POST', { token: link.token });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      status: 'ready',
      registrationRequired: true,
      privacyReady: true,
      accountHint: '…7890',
    });
    expect(preview.headers.get('Cache-Control')).toBe('no-store');
    expect(await db.prepare('SELECT state FROM auth_magic_links').first('state')).toBe('pending');
  });
  it('requires separate registration consent then sets a secure session once', async () => {
    const u = await user(),
      link = await issue(u);
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: link.token })).status).toBe(
      409,
    );
    expect(await db.prepare('SELECT state FROM auth_magic_links').first('state')).toBe('pending');
    const res = await req('/api/v1/auth/magic/finish', 'POST', {
      token: link.token,
      consent: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: null, redirect: '/konto' });
    expect(res.headers.get('Set-Cookie')).toContain('Secure; HttpOnly; SameSite=Strict');
    expect((await req('/api/v1/me', 'GET', undefined, cookie(res))).status).toBe(200);
    expect(
      (await req('/api/v1/auth/magic/finish', 'POST', { token: link.token, consent: true })).status,
    ).toBe(401);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(1);
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(u.id).first('reminders'),
    ).toBe(0);
    expect((await db.prepare('SELECT purpose,accepted FROM consents').all()).results).toEqual([
      { purpose: 'registration', accepted: 1 },
    ]);
  });
  it('allows the established owner to finish setup before public registration is ready', async () => {
    const u = await user('491234567890', false, 'owner');
    await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    const link = await issue(u),
      res = await req('/api/v1/auth/magic/finish', 'POST', { token: link.token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'owner', redirect: '/trainer' });
    expect(
      await db
        .prepare('SELECT registered_at FROM users WHERE id=?')
        .bind(u.id)
        .first('registered_at'),
    ).toBeNull();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(0);
    const me = await req('/api/v1/me', 'GET', undefined, cookie(res));
    expect(await me.json()).toMatchObject({ role: 'owner', registrationRequired: false });
    const member = await user('491234567891'),
      memberLink = await issue(member);
    expect(
      (await req('/api/v1/auth/magic/finish', 'POST', { token: memberLink.token, consent: true }))
        .status,
    ).toBe(503);
  });
  it('revokes earlier links and enforces expiry, origin and issuance rate limits', async () => {
    const u = await user('491234567890', true),
      old = await issue(u),
      latest = await issue(u);
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: old.token })).status).toBe(401);
    expect(
      (
        await req(
          '/api/v1/auth/magic/finish',
          'POST',
          { token: latest.token },
          undefined,
          'https://attacker.invalid',
        )
      ).status,
    ).toBe(403);
    await db.prepare('UPDATE auth_magic_links SET expires_at=0').run();
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: latest.token })).status).toBe(
      401,
    );
    for (let i = 0; i < 3; i++) await issue(u);
    expect((await handleAccountMessage(context(u)))?.join(' ')).toContain('warte zehn Minuten');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_magic_links').first('n')).toBe(5);
  });
  it('rolls back token consumption when session creation fails and recovers on retry', async () => {
    const u = await user('491234567890', true),
      link = await issue(u),
      original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      return original([...statements, db.prepare('INSERT INTO missing_table(value) VALUES(1)')]);
    }) as typeof db.batch;
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: link.token })).status).toBe(
      500,
    );
    expect(await db.prepare('SELECT state FROM auth_magic_links').first('state')).toBe('pending');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(0);
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: link.token })).status).toBe(
      200,
    );
  });
  it('creates exactly one session when two browsers redeem concurrently', async () => {
    const u = await user('491234567890', true),
      link = await issue(u),
      original = db.batch.bind(db);
    // D1 serializes transactions; reproduce that contract with the SQLite adapter.
    let tail: Promise<unknown> = Promise.resolve();
    db.batch = ((statements: D1PreparedStatement[]) => {
      const pending = tail.then(() => original(statements));
      tail = pending.catch(() => undefined);
      return pending;
    }) as typeof db.batch;
    const results = await Promise.all([
      req('/api/v1/auth/magic/finish', 'POST', { token: link.token }),
      req('/api/v1/auth/magic/finish', 'POST', { token: link.token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(1);
  });
  it('cannot use a concurrently revoked role to bypass the registration gate', async () => {
    const u = await user('491234567890', false, 'admin'),
      link = await issue(u),
      original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      await db.prepare('DELETE FROM roles WHERE user_id=?').bind(u.id).run();
      return original(statements);
    }) as typeof db.batch;
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: link.token })).status).toBe(
      401,
    );
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(0);
  });
  it('does not let an old issuance event invalidate the latest link', async () => {
    const u = await user('491234567890', true),
      old = context(u),
      latest = await issue(u);
    await handleAccountMessage(old);
    expect((await req('/api/v1/auth/magic/finish', 'POST', { token: latest.token })).status).toBe(
      200,
    );
  });
});

describe('web account consent and owner role management', () => {
  it('requires reminder consent and cancels pending personal jobs on withdrawal', async () => {
    const u = await user('491234567890', true),
      auth = await session(u);
    expect(
      (await req('/api/v1/account/preferences', 'PATCH', { reminders: true }, auth)).status,
    ).toBe(409);
    expect(
      (
        await req(
          '/api/v1/account/preferences',
          'PATCH',
          { reminders: true, reminderConsent: true, displayName: 'Neuer Name' },
          auth,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await req(
          '/api/v1/account/preferences',
          'PATCH',
          { reminders: true, displayName: 'Neuer Name' },
          auth,
        )
      ).status,
    ).toBe(200);
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM consents WHERE purpose='reminders'").first('n'),
    ).toBe(1);
    await db
      .prepare(
        "INSERT INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at) VALUES('job','job',?,?,'personal_invite','reminder',?,?,?)",
      )
      .bind(u.jid, u.id, now, now + 60000, now)
      .run();
    const res = await req('/api/v1/account/preferences', 'PATCH', { reminders: false }, auth);
    expect(await res.json()).toMatchObject({
      ok: true,
      user: { displayName: 'Neuer Name', reminders: false },
    });
    expect(await db.prepare("SELECT status FROM outbox_jobs WHERE id='job'").first('status')).toBe(
      'cancelled',
    );
    expect(
      (
        await db
          .prepare("SELECT accepted FROM consents WHERE purpose='reminders' ORDER BY rowid")
          .all()
      ).results,
    ).toEqual([{ accepted: 1 }, { accepted: 0 }]);
  });
  it('allows staff to register separately once privacy is ready and keeps reminders off', async () => {
    const u = await user('491234567890', false, 'owner'),
      auth = await session(u);
    expect((await req('/api/v1/account/register', 'POST', {}, auth)).status).toBe(400);
    expect((await req('/api/v1/account/register', 'POST', { consent: true }, auth)).status).toBe(
      200,
    );
    expect(await db.prepare('SELECT reminders FROM users').first('reminders')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(1);
  });
  it('only the fresh owner grants and removes admin to a concrete verified registered identity', async () => {
    const owner = await user('491234567890', false, 'owner'),
      candidate = await user('491234567891', true),
      unknown = await user('491234567892');
    const auth = await session(owner),
      memberAuth = await session(candidate),
      stale = await session(owner, 16 * 60000);
    expect((await req('/api/v1/trainer/admins', 'GET', undefined, memberAuth)).status).toBe(403);
    expect(
      (
        await req(
          '/api/v1/trainer/admins',
          'POST',
          { userId: candidate.id, role: 'admin', confirm: true },
          stale,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          '/api/v1/trainer/admins',
          'POST',
          { userId: unknown.id, role: 'admin', confirm: true },
          auth,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          '/api/v1/trainer/admins',
          'POST',
          { userId: candidate.id, role: 'admin', confirm: true },
          auth,
        )
      ).status,
    ).toBe(200);
    expect(await getRole(db, candidate.id)).toBe('admin');
    expect(
      (await req(`/api/v1/trainer/admins/${owner.id}`, 'DELETE', { confirm: true }, auth)).status,
    ).toBe(409);
    expect(
      (await req(`/api/v1/trainer/admins/${candidate.id}`, 'DELETE', { confirm: true }, auth))
        .status,
    ).toBe(200);
    expect(await getRole(db, candidate.id)).toBeNull();
  });
  it('transfers ownership only after acceptance by the selected fresh authenticated candidate', async () => {
    const owner = await user('491234567890', false, 'owner'),
      candidate = await user('491234567891', true),
      other = await user('491234567892', true);
    const auth = await session(owner),
      candidateAuth = await session(candidate);
    expect(
      (
        await req(
          '/api/v1/trainer/admins/transfer',
          'POST',
          { userId: candidate.id, confirm: true },
          auth,
        )
      ).status,
    ).toBe(200);
    expect(await getRole(db, owner.id)).toBe('owner');
    expect(await getRole(db, candidate.id)).toBeNull();
    const result = (await (
      await req('/api/v1/account/owner-transfer', 'GET', undefined, candidateAuth)
    ).json()) as { transfer: { id: string } };
    expect(
      (
        await req(
          `/api/v1/account/owner-transfer/${result.transfer.id}/accept`,
          'POST',
          { confirm: true },
          await session(other),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          `/api/v1/account/owner-transfer/${result.transfer.id}/accept`,
          'POST',
          { confirm: true },
          candidateAuth,
        )
      ).status,
    ).toBe(200);
    expect(await getRole(db, candidate.id)).toBe('owner');
    expect(await getRole(db, owner.id)).toBe('admin');
    expect(
      (
        await req(
          `/api/v1/account/owner-transfer/${result.transfer.id}/accept`,
          'POST',
          { confirm: true },
          candidateAuth,
        )
      ).status,
    ).toBe(404);
  });
  it('checks owner authority again atomically before a role grant', async () => {
    const owner = await user('491234567890', true, 'owner'),
      second = await user('491234567891', true, 'owner'),
      candidate = await user('491234567892', true);
    const auth = await session(owner),
      original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      await db.prepare('DELETE FROM roles WHERE user_id=?').bind(owner.id).run();
      return original(statements);
    }) as typeof db.batch;
    expect(
      (
        await req(
          '/api/v1/trainer/admins',
          'POST',
          { userId: candidate.id, role: 'admin', confirm: true },
          auth,
        )
      ).status,
    ).toBe(500);
    expect(await getRole(db, candidate.id)).toBeNull();
    expect(await getRole(db, second.id)).toBe('owner');
  });
  it('blocks cross-origin preference writes and preserves the last owner on deletion', async () => {
    const owner = await user('491234567890', false, 'owner'),
      auth = await session(owner);
    expect(
      (
        await req(
          '/api/v1/account/preferences',
          'PATCH',
          { displayName: 'Changed' },
          auth,
          'https://evil.invalid',
        )
      ).status,
    ).toBe(403);
    expect((await req('/api/v1/account/delete', 'POST', { confirm: 'DELETE' }, auth)).status).toBe(
      409,
    );
    const member = await user('491234567891', true),
      memberAuth = await session(member);
    expect(
      (await req('/api/v1/account/delete', 'POST', { confirm: 'DELETE' }, memberAuth)).status,
    ).toBe(200);
    expect(await db.prepare('SELECT id FROM users WHERE id=?').bind(member.id).first()).toBeNull();
    expect((await req('/api/v1/me', 'GET', undefined, memberAuth)).status).toBe(401);
  });
  it('keeps sessions for seven days hard but ends idle trainer sessions after 24 hours', async () => {
    const u = await user('491234567890', true, 'owner'),
      auth = await session(u, 2 * 86400000),
      request = new Request(origin, { headers: { Cookie: auth } });
    expect((await getSession(request, env))?.role).toBe('owner');
    await db
      .prepare('UPDATE auth_sessions SET last_seen_at=?')
      .bind(Date.now() - 86400001)
      .run();
    expect(await getSession(request, env)).toBeNull();
    await db
      .prepare('UPDATE auth_sessions SET authenticated_at=?,last_seen_at=?,expires_at=?')
      .bind(Date.now() - 7 * 86400000 - 1, Date.now(), Date.now() + 100000)
      .run();
    expect(await getSession(request, env)).toBeNull();
  });
});

describe('returning trainers and five-minute links', () => {
  it('expires exactly five minutes after issue', async () => {
    const { token, ctx, reply } = await issue(await user('491234567890', true));
    expect(
      await db.prepare('SELECT expires_at-created_at AS ttl FROM auth_magic_links').first('ttl'),
    ).toBe(300000);
    expect(reply!.join(' ')).toContain('fünf Minuten');
    const clock = Date.now;
    try {
      Date.now = () => ctx.now + 300000;
      expect((await req('/api/v1/auth/magic/preview', 'POST', { token })).status).toBe(401);
      expect((await req('/api/v1/auth/magic/finish', 'POST', { token })).status).toBe(401);
    } finally {
      Date.now = clock;
    }
  });
  it.each(['used', 'revoked', 'expired', 'malformed'])(
    'keeps the cookie session when a %s link is reopened',
    async (state) => {
      const u = await user('491234567890', true, 'admin'),
        { token } = await issue(u),
        cookies = await session(u, 3600000);
      if (state === 'expired') await db.prepare('UPDATE auth_magic_links SET expires_at=0').run();
      else if (state !== 'malformed')
        await db.prepare('UPDATE auth_magic_links SET state=?').bind(state).run();
      const before = await db
        .prepare('SELECT authenticated_at FROM auth_sessions')
        .first('authenticated_at');
      for (const action of ['preview', 'finish']) {
        const result = await req(
          '/api/v1/auth/magic/' + action,
          'POST',
          { token: state === 'malformed' ? 'broken' : token },
          cookies,
        );
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({ redirect: '/trainer', role: 'admin' });
        expect(result.headers.get('Set-Cookie')).toBeNull();
      }
      expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(1);
      expect(
        await db.prepare('SELECT authenticated_at FROM auth_sessions').first('authenticated_at'),
      ).toBe(before);
    },
  );
  it('allows deliberate same-account reauthentication, but never silently switches accounts', async () => {
    const u = await user('491234567890', true, 'admin'),
      cookies = await session(u, 3600000);
    const { token } = await issue(u);
    const other = await issue(await user('491234567891', true));
    expect(
      (
        await req(
          '/api/v1/auth/magic/finish',
          'POST',
          { token: other.token, reauthenticate: true },
          cookies,
        )
      ).status,
    ).toBe(403);
    const result = await req(
      '/api/v1/auth/magic/finish',
      'POST',
      { token, reauthenticate: true },
      cookies,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('Set-Cookie')).toContain('__Host-tt-session');
  });
  it('provides an explicit reauthentication link from WhatsApp', async () => {
    const reply = await handleAccountMessage(
      context(await user('491234567890', true, 'admin'), '/login neu'),
    );
    expect(reply!.join(' ')).toMatch(/\/login\?reauth=1#[a-f0-9]{48}/);
  });
});
