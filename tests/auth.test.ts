import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { testDb } from './helpers/db';
import {
  getRole,
  getSession,
  handleAccountMessage,
  registerAuthRoutes,
  resolveUser,
} from '../apps/worker/src/auth';
import { consumeRateLimit, hashToken, randomToken } from '../apps/worker/src/security';
import type { AppBindings, BotContext, Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, app: Hono<AppBindings>, clock: number;
const origin = 'https://tt.example.org';
beforeEach(async () => {
  db = testDb();
  env = {
    DB: db,
    ASSETS: {
      fetch: async () => new Response(''),
      connect: () => {
        throw new Error('unused');
      },
    },
    EVOLUTION_URL: 'https://evolution.test',
    EVOLUTION_INSTANCE: 'test',
    EVOLUTION_API_KEY: 'test-fixture-key',
  };
  app = new Hono<AppBindings>();
  registerAuthRoutes(app);
  clock = Date.now();
  await db.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'").run();
  await db
    .prepare("INSERT INTO settings(key,value) VALUES('bot_jid','491234567890@s.whatsapp.net')")
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
async function user(number = '491234567891'): Promise<User> {
  return (await resolveUser(env, `${number}@s.whatsapp.net`, [], 'Test Name', clock))!;
}
async function context(
  u: User,
  text: string,
  overrides: Partial<BotContext> = {},
): Promise<BotContext> {
  clock += 1000;
  return {
    env,
    user: (await db.prepare('SELECT * FROM users WHERE id=?').bind(u.id).first<User>()) ?? u,
    text,
    chatJid: u.jid,
    isGroup: false,
    now: clock,
    timestamp: clock,
    eventId: crypto.randomUUID(),
    origin,
    ...overrides,
  };
}
async function send(
  u: User,
  text: string,
  overrides: Partial<BotContext> = {},
): Promise<string[] | null> {
  return handleAccountMessage(await context(u, text, overrides));
}
async function owner(u: User): Promise<void> {
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?)")
    .bind(u.id, clock)
    .run();
}
async function register(u: User): Promise<void> {
  await send(u, '/registrieren');
  await send(u, 'JA');
}
async function request(
  path: string,
  method = 'GET',
  cookies?: string,
  requestOrigin = origin,
): Promise<Response> {
  return app.request(
    `${origin}${path}`,
    { method, headers: { Origin: requestOrigin, ...(cookies ? { Cookie: cookies } : {}) } },
    env,
  );
}
function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
}
async function start() {
  const response = await request('/api/v1/auth/start', 'POST');
  expect(response.status).toBe(200);
  return {
    response,
    cookie: cookies(response),
    ...((await response.json()) as { code: string; waLink: string; expiresAt: number }),
  };
}

describe('identity mapping', () => {
  it('does not infer identity from display names or create a registered account', async () => {
    const a = await user(),
      b = await user('491234567892');
    expect(a.id).not.toBe(b.id);
    expect(a.registered_at).toBeNull();
    expect(a.reminders).toBe(0);
  });
  it('accepts provider aliases but rejects conflicts without merging', async () => {
    const a = await user(),
      b = await user('491234567892');
    expect(await resolveUser(env, a.jid, [b.jid], 'Same', clock)).toBeNull();
    const mapped = await resolveUser(env, a.jid, ['12345678901@lid'], 'Other', clock);
    expect(mapped?.id).toBe(a.id);
    expect((await resolveUser(env, '12345678901@lid', [], '', clock))?.id).toBe(a.id);
    expect(await resolveUser(env, '12345@g.us', [], '', clock)).toBeNull();
  });
  it('fills a discovered blank name on the next authenticated event without registering the user', async () => {
    const jid = '491234567891@s.whatsapp.net';
    const discovered = await resolveUser(env, jid, [], '', clock);
    expect(discovered?.display_name).toBe('');
    expect((await resolveUser(env, jid, [], '   ', clock))?.display_name).toBe('');
    const named = await resolveUser(env, jid, ['12345678901@lid'], '  Marius  ', clock + 1);
    expect(named).toMatchObject({
      id: discovered!.id,
      display_name: 'Marius',
      registered_at: null,
      reminders: 0,
    });
    expect(
      (await resolveUser(env, '12345678901@lid', [], 'Different push name', clock + 2))
        ?.display_name,
    ).toBe('Marius');
  });
  it('preserves an existing custom name and one concurrently saved before the fill', async () => {
    const a = await resolveUser(env, '491234567891@s.whatsapp.net', [], '', clock);
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.batch = batch;
      await db
        .prepare('UPDATE users SET display_name=? WHERE id=?')
        .bind('Mein Profilname', a!.id)
        .run();
      return batch(statements);
    };
    expect((await resolveUser(env, a!.jid, [], 'WhatsApp Name', clock + 1))?.display_name).toBe(
      'Mein Profilname',
    );
    expect((await resolveUser(env, a!.jid, [], 'Anderer Name', clock + 2))?.display_name).toBe(
      'Mein Profilname',
    );
  });
  it('rolls back name filling when an alias is concurrently claimed by another user', async () => {
    const a = await resolveUser(env, '491234567891@s.whatsapp.net', [], '', clock),
      b = await user('491234567892');
    const batch = db.batch.bind(db),
      lid = '12345678901@lid';
    db.batch = async (statements) => {
      db.batch = batch;
      await db
        .prepare('INSERT INTO identity_aliases(jid,user_id) VALUES(?,?)')
        .bind(lid, b.id)
        .run();
      return batch(statements);
    };
    expect(await resolveUser(env, a!.jid, [lid], 'Wrong identity name', clock + 1)).toBeNull();
    expect(
      await db
        .prepare('SELECT display_name FROM users WHERE id=?')
        .bind(a!.id)
        .first('display_name'),
    ).toBe('');
  });
  it('bounds newly filled provider names to eighty characters', async () => {
    const a = await resolveUser(env, '491234567891@s.whatsapp.net', [], '', clock);
    expect((await resolveUser(env, a!.jid, [], 'N'.repeat(120), clock + 1))?.display_name).toBe(
      'N'.repeat(80),
    );
  });
  it('enforces an atomic rate limit and expiration', async () => {
    expect(await consumeRateLimit(db, 'key', 2, 1000, clock)).toBe(true);
    expect(await consumeRateLimit(db, 'key', 2, 1000, clock)).toBe(true);
    expect(await consumeRateLimit(db, 'key', 2, 1000, clock)).toBe(false);
    expect(await consumeRateLimit(db, 'key', 2, 1000, clock + 1000)).toBe(true);
  });
});

describe('bootstrap and role management', () => {
  async function bootstrap(code: string) {
    await db
      .prepare("INSERT INTO bootstrap(id,state,code_hash,expires_at) VALUES(1,'pending',?,?)")
      .bind(await hashToken(code), clock + 60_000)
      .run();
  }
  it('reserves the first valid identity, needs JA and never reopens after success', async () => {
    const a = await user(),
      b = await user('491234567892'),
      code = randomToken(16);
    await bootstrap(code);
    await send(a, `/einrichten ${code}`);
    expect(await getRole(db, a.id)).toBeNull();
    await send(b, `/einrichten ${code}`);
    await send(b, 'JA');
    expect(await getRole(db, b.id)).toBeNull();
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBe('owner');
    await send(b, `/einrichten ${code}`);
    expect(await getRole(db, b.id)).toBeNull();
    expect(await db.prepare('SELECT state,code_hash FROM bootstrap').first()).toEqual({
      state: 'completed',
      code_hash: null,
    });
  });
  it('wrong, expired and group bootstrap codes cannot grant roles', async () => {
    const a = await user(),
      code = randomToken(16);
    await bootstrap(code);
    await send(a, `/einrichten ${randomToken(16)}`);
    expect(await getRole(db, a.id)).toBeNull();
    await send(a, `/einrichten ${code}`, { isGroup: true });
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBeNull();
    clock += 61_000;
    await send(a, `/einrichten ${code}`);
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBeNull();
  });
  it('NEIN permanently closes bootstrap until local operator intervention', async () => {
    const a = await user(),
      code = randomToken(16);
    await bootstrap(code);
    await send(a, `/einrichten ${code}`);
    await send(a, 'NEIN');
    await send(a, `/einrichten ${code}`);
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBeNull();
    expect(await db.prepare('SELECT state FROM bootstrap').first('state')).toBe('closed');
  });
  it('accepts a hashed bootstrap credential from the sanitized inbox', async () => {
    const a = await user(),
      code = randomToken(16);
    await bootstrap(code);
    await send(a, '/einrichten [geschützt]', { credentialHash: await hashToken(code) });
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBe('owner');
  });
  it('invitation requires candidate claim and owner confirmation of the actual JID', async () => {
    const a = await user(),
      b = await user('491234567892');
    await owner(a);
    const issued = (await send(a, '/admin einladen'))![0],
      code = issued.match(/\/admin ([a-f0-9]{32})/)![1];
    const id = await db.prepare('SELECT id FROM admin_invites').first<string>('id');
    await send(b, `/admin ${code}`);
    expect(await getRole(db, b.id)).toBeNull();
    const prompt = (await send(a, `/admin bestätigen ${id}`))![0];
    expect(prompt).toContain(b.jid);
    await send(a, 'JA');
    expect(await getRole(db, b.id)).toBe('admin');
    await send(a, `/admin entfernen ${b.id}`);
    expect(await getRole(db, b.id)).toBe('admin');
    await send(a, 'JA');
    expect(await getRole(db, b.id)).toBeNull();
  });
  it('transfers ownership only after both parties act and protects the final owner', async () => {
    const a = await user(),
      b = await user('491234567892');
    await owner(a);
    await expect(db.prepare('DELETE FROM roles WHERE user_id=?').bind(a.id).run()).rejects.toThrow(
      'last_owner',
    );
    await expect(
      db.prepare("UPDATE roles SET role='admin' WHERE user_id=?").bind(a.id).run(),
    ).rejects.toThrow('last_owner');
    const code = (await send(a, '/admin übertragen'))![0].match(/\/admin ([a-f0-9]{32})/)![1];
    await send(b, `/admin ${code}`);
    const id = await db.prepare('SELECT id FROM admin_invites').first<string>('id');
    await send(a, `/admin bestätigen ${id}`);
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBe('admin');
    expect(await getRole(db, b.id)).toBe('owner');
  });
});

describe('registration, reminders and privacy', () => {
  it('fails closed before privacy release and never registers from group commands', async () => {
    const a = await user();
    await send(a, '/login', { isGroup: true });
    await send(a, 'JA');
    expect(
      await db
        .prepare('SELECT registered_at FROM users WHERE id=?')
        .bind(a.id)
        .first('registered_at'),
    ).toBeNull();
    await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    await send(a, '/login');
    await send(a, 'JA');
    expect(
      await db
        .prepare('SELECT registered_at FROM users WHERE id=?')
        .bind(a.id)
        .first('registered_at'),
    ).toBeNull();
  });
  it('keeps registration and reminder consent separate; /stop cancels already queued jobs', async () => {
    const a = await user();
    await register(a);
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(a.id).first('reminders'),
    ).toBe(0);
    await send(a, '/start');
    await send(a, 'JA');
    await db
      .prepare(
        "INSERT INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at) VALUES('j','j',?,?,'personal_invite','Reminder',?,?,?)",
      )
      .bind(a.jid, a.id, clock, clock + 60_000, clock)
      .run();
    await send(a, '/stop');
    expect(await db.prepare("SELECT status FROM outbox_jobs WHERE id='j'").first('status')).toBe(
      'cancelled',
    );
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(a.id).first('reminders'),
    ).toBe(0);
    expect(
      (await db.prepare('SELECT purpose,accepted FROM consents ORDER BY created_at').all()).results,
    ).toEqual([
      { purpose: 'registration', accepted: 1 },
      { purpose: 'reminders', accepted: 1 },
      { purpose: 'reminders', accepted: 0 },
    ]);
  });
  it('stops member reminders and trainer summaries together without stopping group training', async () => {
    const a = await user();
    await owner(a);
    await db.prepare('UPDATE users SET reminders=1 WHERE id=?').bind(a.id).run();
    await db
      .prepare('INSERT INTO trainer_summary_preferences(user_id,enabled,updated_at) VALUES(?,1,?)')
      .bind(a.id, clock)
      .run();
    await db.prepare("UPDATE settings SET value='1' WHERE key='enabled'").run();
    for (const kind of ['personal_invite', 'trainer_summary'])
      await db
        .prepare(
          "INSERT INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at,status) VALUES(?,?,?,?,?,'Reminder',?,?,?,'processing')",
        )
        .bind(kind, kind, a.jid, a.id, kind, clock, clock + 60000, clock)
        .run();
    const stop = await context(a, '/stop');
    expect(await handleAccountMessage(stop)).toEqual([
      'Persönliche Erinnerungen und Trainerübersichten sind ausgeschaltet.',
    ]);
    await handleAccountMessage(stop);
    expect(
      await db.prepare('SELECT registered_at,reminders FROM users WHERE id=?').bind(a.id).first(),
    ).toEqual({ registered_at: null, reminders: 0 });
    expect(
      await db
        .prepare('SELECT enabled,version FROM trainer_summary_preferences WHERE user_id=?')
        .bind(a.id)
        .first(),
    ).toEqual({ enabled: 0, version: 2 });
    expect(
      (await db.prepare('SELECT kind,status FROM outbox_jobs ORDER BY kind').all()).results,
    ).toEqual([
      { kind: 'personal_invite', status: 'cancelled' },
      { kind: 'trainer_summary', status: 'cancelled' },
    ]);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM consents WHERE purpose='trainer_summary' AND accepted=0",
        )
        .first('n'),
    ).toBe(1);
    expect(await db.prepare("SELECT value FROM settings WHERE key='enabled'").first('value')).toBe(
      '1',
    );
  });
  it('rolls the entire stop back on failure and preserves a newer trainer preference', async () => {
    const a = await user();
    await db.prepare('UPDATE users SET reminders=1 WHERE id=?').bind(a.id).run();
    await db
      .prepare('INSERT INTO trainer_summary_preferences(user_id,enabled,updated_at) VALUES(?,1,?)')
      .bind(a.id, clock)
      .run();
    await db.exec(
      "CREATE TRIGGER stop_failure BEFORE UPDATE ON trainer_summary_preferences BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    const stop = await context(a, '/stop');
    await expect(handleAccountMessage(stop)).rejects.toThrow('fixture failure');
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(a.id).first('reminders'),
    ).toBe(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_receipts').first('n')).toBe(0);
    await db.exec('DROP TRIGGER stop_failure');
    await db
      .prepare('UPDATE trainer_summary_preferences SET updated_at=? WHERE user_id=?')
      .bind(stop.timestamp + 1, a.id)
      .run();
    expect((await handleAccountMessage(stop))![0]).toContain('neuere Nachrichteneinstellung');
    expect(
      await db
        .prepare('SELECT enabled FROM trainer_summary_preferences WHERE user_id=?')
        .bind(a.id)
        .first('enabled'),
    ).toBe(1);
  });
  it('requires an unexpired, newer, explicit confirmation and ignores replays', async () => {
    const a = await user();
    const initial = await context(a, '/registrieren');
    await handleAccountMessage(initial);
    await send(a, 'JA', { timestamp: initial.timestamp });
    expect(
      await db
        .prepare('SELECT registered_at FROM users WHERE id=?')
        .bind(a.id)
        .first('registered_at'),
    ).toBeNull();
    const confirm = await context(a, 'JA');
    await handleAccountMessage(confirm);
    expect((await handleAccountMessage(confirm))![0]).toContain('bereits verarbeitet');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(1);
  });
  it('does not replay an old consent dialog across a newer withdrawal', async () => {
    const a = await user();
    await register(a);
    const oldStart = await context(a, '/start'),
      oldYes = await context(a, 'JA');
    await send(a, '/stop');
    await handleAccountMessage(oldStart);
    await handleAccountMessage(oldYes);
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(a.id).first('reminders'),
    ).toBe(0);
    await send(a, '/start');
    const oldStop = await context(a, '/stop');
    await send(a, 'JA');
    await handleAccountMessage(oldStop);
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(a.id).first('reminders'),
    ).toBe(1);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM consents WHERE purpose='reminders' AND accepted=0")
        .first('n'),
    ).toBe(1);
  });
  it('rolls the complete confirmation back if a concurrent command replaces its dialog', async () => {
    const a = await user();
    await send(a, '/registrieren');
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.batch = batch;
      await db.prepare("UPDATE conversations SET data='{}' WHERE user_id=?").bind(a.id).run();
      return batch(statements);
    };
    await expect(send(a, 'JA')).rejects.toThrow('CHECK');
    expect(
      await db
        .prepare('SELECT registered_at FROM users WHERE id=?')
        .bind(a.id)
        .first('registered_at'),
    ).toBeNull();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(0);
  });
  it('deletes user data and sessions after consent, but refuses owner deletion', async () => {
    const a = await user(),
      b = await user('491234567892');
    await owner(a);
    await register(b);
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at) VALUES(?,?,?,?)',
      )
      .bind(await hashToken(randomToken()), b.id, clock, clock + 60_000)
      .run();
    await send(a, '/löschen');
    await send(a, 'JA');
    expect(await getRole(db, a.id)).toBe('owner');
    await send(b, '/löschen');
    await send(b, 'JA');
    expect(await db.prepare('SELECT id FROM users WHERE id=?').bind(b.id).first()).toBeNull();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(0);
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM consents WHERE user_id=?').bind(b.id).first('n'),
    ).toBe(0);
  });
});

describe('browser-bound authentication', () => {
  it('rejects missing/foreign origin and does not start authentication through GET', async () => {
    expect(
      (await request('/api/v1/auth/start', 'POST', undefined, 'https://evil.example')).status,
    ).toBe(403);
    expect((await app.request(`${origin}/api/v1/auth/start`, { method: 'POST' }, env)).status).toBe(
      403,
    );
    expect((await request('/api/v1/auth/start')).status).toBe(404);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_challenges').first('n')).toBe(0);
  });
  it('requires explicit WhatsApp confirmation, exchanges only once, and revokes on logout', async () => {
    const a = await user();
    await register(a);
    const auth = await start();
    expect(auth.code).toHaveLength(32);
    expect(auth.waLink).toContain(encodeURIComponent(`/login ${auth.code}`));
    expect(
      (await request('/api/v1/auth/status', 'GET', auth.cookie)).headers.get('Cache-Control'),
    ).toBe('no-store');
    await send(a, `/login ${auth.code}`);
    expect((await request('/api/v1/auth/finish', 'POST', auth.cookie)).status).toBe(401);
    await send(a, 'JA');
    expect(await (await request('/api/v1/auth/status', 'GET', auth.cookie)).json()).toEqual({
      status: 'confirmed',
    });
    expect(
      await (
        await request('/api/v1/auth/status', 'GET', '__Host-tt-browser=' + randomToken())
      ).json(),
    ).toEqual({ status: 'expired' });
    expect(
      (await request('/api/v1/auth/finish', 'POST', '__Host-tt-browser=' + randomToken())).status,
    ).toBe(401);
    const finished = await request('/api/v1/auth/finish', 'POST', auth.cookie);
    expect(finished.status).toBe(200);
    expect(finished.headers.get('Set-Cookie')).toContain('Secure; HttpOnly; SameSite=Strict');
    const sessionCookie = cookies(finished);
    expect((await request('/api/v1/me', 'GET', sessionCookie)).status).toBe(200);
    expect((await request('/api/v1/auth/finish', 'POST', auth.cookie)).status).toBe(401);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n')).toBe(1);
    await request('/api/v1/auth/logout', 'POST', sessionCookie);
    expect((await request('/api/v1/me', 'GET', sessionCookie)).status).toBe(401);
  });
  it('a login for an unregistered person needs a separate registration confirmation', async () => {
    const a = await user(),
      auth = await start();
    await send(a, `/login ${auth.code}`);
    await send(a, 'JA');
    expect(await (await request('/api/v1/auth/status', 'GET', auth.cookie)).json()).toEqual({
      status: 'pending',
    });
    await send(a, 'JA');
    expect(await (await request('/api/v1/auth/status', 'GET', auth.cookie)).json()).toEqual({
      status: 'confirmed',
    });
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(a.id).first('reminders'),
    ).toBe(0);
  });
  it('accepts a hashed challenge from the sanitized inbox without storing the raw code', async () => {
    const a = await user();
    await register(a);
    const auth = await start();
    await send(a, '/login [geschützt]', { credentialHash: await hashToken(auth.code) });
    await send(a, 'JA');
    expect(await (await request('/api/v1/auth/status', 'GET', auth.cookie)).json()).toEqual({
      status: 'confirmed',
    });
    expect(
      JSON.stringify((await db.prepare('SELECT * FROM auth_challenges').all()).results),
    ).not.toContain(auth.code);
    expect(
      JSON.stringify((await db.prepare('SELECT * FROM conversations').all()).results),
    ).not.toContain(auth.code);
  });
  it('rejects challenges after expiry and after a denial', async () => {
    const a = await user();
    await register(a);
    const denied = await start();
    await send(a, `/login ${denied.code}`);
    await send(a, 'NEIN');
    expect((await request('/api/v1/auth/finish', 'POST', denied.cookie)).status).toBe(401);
    const expired = await start();
    await db.prepare('UPDATE auth_challenges SET expires_at=0').run();
    await send(a, `/login ${expired.code}`);
    await send(a, 'JA');
    expect((await request('/api/v1/auth/finish', 'POST', expired.cookie)).status).toBe(401);
  });
  it('uses live roles and caps sessions newly promoted to admin after 24 idle hours', async () => {
    const a = await user();
    await register(a);
    const token = randomToken();
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at) VALUES(?,?,?,?)',
      )
      .bind(await hashToken(token), a.id, clock - 25 * 60 * 60_000, clock + 60_000)
      .run();
    const req = new Request(origin, { headers: { Cookie: `__Host-tt-session=${token}` } });
    expect((await getSession(req, env, clock))?.role).toBeNull();
    await owner(a);
    expect((await getSession(req, env, clock))?.role).toBe('owner');
    await db.prepare('UPDATE auth_sessions SET last_seen_at=authenticated_at').run();
    expect(await getSession(req, env, clock)).toBeNull();
  });
});
