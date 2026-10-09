import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { app } from '../apps/worker/src/index';
import { resolveUser } from '../apps/worker/src/auth';
import { hashToken } from '../apps/worker/src/security';
import { occurrence } from '@tt/core';
import type { Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, member: User, now: number, cookie: string;
const origin = 'https://tt.bz3.eu',
  group = '120363123456@g.us',
  webhookToken = 'test-webhook-token';
beforeEach(async () => {
  db = testDb();
  now = Date.parse('2026-10-08T12:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  env = {
    DB: db,
    ASSETS: { fetch: vi.fn(async () => new Response('asset content')) } as unknown as Fetcher,
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'tt-test',
    EVOLUTION_API_KEY: 'test-provider-secret',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ key: { id: crypto.randomUUID() } }), { status: 201 }),
    ),
  );
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare('INSERT INTO settings(key,value) VALUES(?,?)')
    .bind('webhook_token_hash', await hashToken(webhookToken))
    .run();
  await db
    .prepare("INSERT INTO settings(key,value) VALUES('bot_jid','491701234567@s.whatsapp.net')")
    .run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('selected_group',?)").bind(group).run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', now)
    .run();
  member = (await resolveUser(
    env,
    '491701234568@s.whatsapp.net',
    [],
    'Private participant name',
    now,
  ))!;
  await db.prepare('UPDATE users SET registered_at=? WHERE id=?').bind(now, member.id).run();
  await db
    .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
    .bind(group, member.id, now)
    .run();
  const times = occurrence({ weekday: 4, startTime: '18:00', endTime: '20:00' }, '2026-10-08');
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-08',?,?,'Europe/Berlin','Sporthalle',?,?,?)",
    )
    .bind(group, times.startAt, times.endAt, times.reminderAt, times.lateReminderAt, now)
    .run();
  const token = 'a'.repeat(64);
  cookie = `__Host-tt-session=${token}`;
  await db
    .prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at) VALUES(?,?,?,?)',
    )
    .bind(await hashToken(token), member.id, now, now + 86400_000)
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function request(path: string, init: RequestInit = {}) {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (task: Promise<unknown>) => tasks.push(task),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const response = await app.fetch(new Request(`${origin}${path}`, init), env, ctx);
  await Promise.allSettled(tasks);
  return response;
}
function webhook(id = 'provider-id', instance = 'tt-test') {
  return {
    instance,
    event: 'messages.upsert',
    apikey: 'secret-provider-envelope',
    data: {
      key: { id, remoteJid: member.jid, fromMe: false },
      messageTimestamp: now / 1000,
      message: { conversation: '/hilfe' },
    },
  };
}
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Origin: origin, Cookie: cookie });

describe('HTTP boundary and public privacy', () => {
  it('returns narrow health data and security headers without identities or provider configuration', async () => {
    const response = await request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'TT' });
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('Strict-Transport-Security')).toContain('31536000');
  });
  it.each(['/api/v1/unknown', '/api/arbitrary', '/webhooks/unknown'])(
    'keeps %s as JSON 404 rather than asset HTML fallback',
    async (path) => {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'not_found' });
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    },
  );
  it('serves public training details without exposing participant lists and escapes configured prose', async () => {
    await db
      .prepare(
        "UPDATE settings SET value='<script>alert(1)</script> & Vereinsinfo' WHERE key='info_text'",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES('training',?,'yes',?)",
      )
      .bind(member.id, now)
      .run();
    const response = await request('/t/training');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Sporthalle');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain(member.display_name);
    expect(html).not.toContain(member.jid);
  });
  it('retires old training links without a WhatsApp round trip or exposed training ID', async () => {
    const login = await request('/login');
    expect(login.status).toBe(200);
    expect(login.headers.get('Cache-Control')).toBe('no-store');
    const redirect = await request('/r/training');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Location')).toBe('/info');
    expect(redirect.headers.get('Cache-Control')).toBe('no-store');
    await db.prepare("UPDATE training_sessions SET status='cancelled'").run();
    expect((await request('/r/training')).status).toBe(404);
  });
  it('requires a session for member APIs and scopes sessions to current group membership', async () => {
    const anonymous = await request('/api/v1/sessions');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
    const visible = await request('/api/v1/sessions', { headers: { Cookie: cookie } });
    expect(((await visible.json()) as { sessions: unknown[] }).sessions.length).toBe(1);
    await db.prepare('UPDATE memberships SET active=0').run();
    const removed = await request('/api/v1/sessions', { headers: { Cookie: cookie } });
    expect(await removed.json()).toEqual({ sessions: [] });
  });
});

describe('authenticated webhook boundary', () => {
  const headers = () => ({
    Authorization: `Bearer ${webhookToken}`,
    'Content-Type': 'application/json',
  });
  it('rejects wrong credentials, bad JSON and foreign instances before durable ingestion', async () => {
    expect(
      (
        await request('/webhooks/evolution', {
          method: 'POST',
          body: JSON.stringify(webhook()),
          headers: { ...headers(), Authorization: 'Bearer wrong-token' },
        })
      ).status,
    ).toBe(401);
    expect(
      (await request('/webhooks/evolution', { method: 'POST', body: '{bad', headers: headers() }))
        .status,
    ).toBe(400);
    expect(
      (
        await request('/webhooks/evolution', {
          method: 'POST',
          body: JSON.stringify(webhook('foreign', 'foreign-instance')),
          headers: headers(),
        })
      ).status,
    ).toBe(403);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM inbox_events').first()).toEqual({ n: 0 });
  });
  it('acknowledges durable accepted events, resumes them with waitUntil and safely deduplicates retries', async () => {
    const body = JSON.stringify(webhook());
    const first = await request('/webhooks/evolution', {
      method: 'POST',
      body,
      headers: headers(),
    });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: 1 });
    const repeated = await request('/webhooks/evolution', {
      method: 'POST',
      body,
      headers: headers(),
    });
    expect(repeated.status).toBe(202);
    expect(await repeated.json()).toEqual({ accepted: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM inbox_events').first()).toEqual({ n: 1 });
    expect(await db.prepare('SELECT status,payload FROM inbox_events').first()).toEqual({
      status: 'done',
      payload: '',
    });
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE status='sent'").first(),
    ).toEqual({ n: 1 });
    expect(
      JSON.stringify((await db.prepare('SELECT text FROM outbox_jobs').all()).results),
    ).not.toContain('secret-provider-envelope');
  });
  it('applies the body size boundary before parsing or storing an oversized payload', async () => {
    const response = await request('/webhooks/evolution', {
      method: 'POST',
      body: 'x'.repeat(256 * 1024 + 1),
      headers: headers(),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'body_too_large' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM inbox_events').first()).toEqual({ n: 0 });
  });
});

describe('web participation shares WhatsApp domain validation', () => {
  it('requires matching origin, rejects cross-site requests, validates JSON and detects changed versions', async () => {
    const body = JSON.stringify({ response: 'yes', version: 1 });
    expect(
      (
        await request('/api/v1/sessions/training/attendance', {
          method: 'POST',
          body,
          headers: { ...jsonHeaders(), Origin: 'https://attacker.invalid' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/v1/sessions/training/attendance', {
          method: 'POST',
          body,
          headers: { ...jsonHeaders(), 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/v1/sessions/training/attendance', {
          method: 'POST',
          body: JSON.stringify({ response: 'late', minutes: 241, version: 1 }),
          headers: jsonHeaders(),
        })
      ).status,
    ).toBe(400);
    await db.prepare('UPDATE training_sessions SET version=2').run();
    expect(
      (
        await request('/api/v1/sessions/training/attendance', {
          method: 'POST',
          body,
          headers: jsonHeaders(),
        })
      ).status,
    ).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first()).toEqual({ n: 0 });
  });
  it('records a valid private web response through the same membership and participation service', async () => {
    const response = await request('/api/v1/sessions/training/attendance', {
      method: 'POST',
      body: JSON.stringify({ response: 'late', minutes: 10, version: 1 }),
      headers: jsonHeaders(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'updated' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await db.prepare('SELECT response,punctuality,minutes FROM attendance').first()).toEqual(
      { response: 'yes', punctuality: 'late', minutes: 10 },
    );
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first()).toEqual({ n: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await db.prepare('UPDATE memberships SET active=0').run();
    expect(
      (
        await request('/api/v1/sessions/training/attendance', {
          method: 'POST',
          body: JSON.stringify({ response: 'yes', version: 1 }),
          headers: jsonHeaders(),
        })
      ).status,
    ).toBe(404);
  });
  it('updates an explicitly authorized second group independently of the trainer selected group', async () => {
    const other = '120363999999@g.us';
    await db
      .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
      .bind(other, 'TT zweite Gruppe', now)
      .run();
    await db
      .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
      .bind(other, member.id, now)
      .run();
    await db
      .prepare(
        "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) SELECT 'other-training',?,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at FROM training_sessions WHERE id='training'",
      )
      .bind(other)
      .run();
    const response = await request('/api/v1/sessions/other-training/attendance', {
      method: 'POST',
      body: JSON.stringify({ response: 'yes', version: 1 }),
      headers: jsonHeaders(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'updated' });
    expect(await db.prepare('SELECT session_id,response FROM attendance').first()).toEqual({
      session_id: 'other-training',
      response: 'yes',
    });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first()).toEqual({ n: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['version', 'cancellation', 'membership'])(
    'rejects an intervening %s mutation atomically instead of writing stale attendance',
    async (mutation) => {
      const original = db.prepare.bind(db);
      let mutated = false;
      vi.spyOn(db, 'prepare').mockImplementation((sql) => {
        const statement = original(sql);
        if (!sql.startsWith('UPDATE attendance SET')) return statement;
        const bind = statement.bind.bind(statement);
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            const bound = bind(...values),
              execute = bound.all.bind(bound);
            return {
              ...bound,
              all: async () => {
                if (!mutated) {
                  mutated = true;
                  await original(
                    mutation === 'version'
                      ? 'UPDATE training_sessions SET version=2'
                      : mutation === 'cancellation'
                        ? "UPDATE training_sessions SET status='cancelled'"
                        : 'UPDATE memberships SET active=0',
                  ).run();
                }
                return execute();
              },
            } as D1PreparedStatement;
          },
        } as D1PreparedStatement;
      });
      const response = await request('/api/v1/sessions/training/attendance', {
        method: 'POST',
        body: JSON.stringify({ response: 'yes', version: 1 }),
        headers: jsonHeaders(),
      });
      expect(mutated).toBe(true);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'session_changed' });
      expect(
        await original('SELECT response,punctuality,response_at FROM attendance').first(),
      ).toEqual({ response: 'unknown', punctuality: 'unknown', response_at: 0 });
      expect(await original('SELECT COUNT(*) AS n FROM outbox_jobs').first()).toEqual({ n: 0 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});
