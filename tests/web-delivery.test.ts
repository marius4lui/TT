import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, scheduled } from '../apps/worker/src/index';
import { hashToken } from '../apps/worker/src/security';
import type { Env } from '../apps/worker/src/types';
import { testDb } from './helpers/db';

const origin = 'https://club.example.org';
const now = Date.parse('2026-10-21T08:00:00Z');
const group = '120363123456@g.us';
let db: ReturnType<typeof testDb>, env: Env;
let sends: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  db = testDb();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://provider.invalid',
    EVOLUTION_INSTANCE: 'club',
    EVOLUTION_API_KEY: 'synthetic-key',
  };
  sends = vi.fn(async () => new Response(JSON.stringify({ key: { id: crypto.randomUUID() } })));
  vi.stubGlobal('fetch', sends);
  await db.prepare("UPDATE settings SET value=? WHERE key='origin'").bind(origin).run();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare(
      "INSERT INTO users(id,jid,display_name,created_at) VALUES('owner','491701000001@s.whatsapp.net','Trainer',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES('owner','admin',?)")
    .bind(now)
    .run();
  await db
    .prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)',
    )
    .bind(await hashToken('a'.repeat(64)), 'owner', now, now + 86400_000, now)
    .run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'Club', now)
    .run();
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-22',?,?,'Europe/Berlin','Halle',?,?,?)",
    )
    .bind(
      group,
      now + 32 * 3600000,
      now + 34 * 3600000,
      now + 8 * 3600000,
      now + 31.5 * 3600000,
      now,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO messages(id,chat_jid,session_id,session_version,kind,created_at) VALUES('old-invite',?,'training',1,'invite',?)",
    )
    .bind(group, now - 1000)
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function request(path: string, method: string, body?: unknown) {
  const tasks: Promise<unknown>[] = [];
  const response = await app.fetch(
    new Request(`${origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: `__Host-tt-session=${'a'.repeat(64)}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil: (task: Promise<unknown>) => tasks.push(task) } as unknown as ExecutionContext,
  );
  await Promise.all(tasks);
  return { response, tasks };
}

describe('web mutations wake durable delivery without another webhook or cron', () => {
  it('sends a moved training immediately on a custom domain and cron does not duplicate it', async () => {
    const { response, tasks } = await request('/api/v1/trainer/sessions/training/move', 'POST', {
      version: 1,
      date: '2026-10-23',
      startTime: '18:00',
    });
    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(1);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sends.mock.calls[0][1].body).text).toContain('23.10.2026');
    expect(await db.prepare("SELECT status FROM outbox_jobs WHERE kind='change'").first()).toEqual({
      status: 'sent',
    });
    await scheduled(env, now);
    expect(sends).toHaveBeenCalledTimes(1);
  });
  it('sends a cancellation immediately', async () => {
    const { response } = await request('/api/v1/trainer/sessions/training/cancel', 'POST', {
      version: 1,
    });
    expect(response.status).toBe(200);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sends.mock.calls[0][1].body).text).toContain('abgesagt');
  });
  it('plans and sends a newly due invitation after moving a previously uninvited training', async () => {
    await db.prepare('DELETE FROM messages').run();
    const { response } = await request('/api/v1/trainer/sessions/training/move', 'POST', {
      version: 1,
      date: '2026-10-21',
      startTime: '18:00',
    });
    expect(response.status).toBe(200);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(
      await db
        .prepare("SELECT status,session_version FROM outbox_jobs WHERE kind='invite'")
        .first(),
    ).toEqual({ status: 'sent', session_version: 2 });
  });
  it('keeps paused installations silent', async () => {
    await db.prepare("UPDATE settings SET value='0' WHERE key='enabled'").run();
    expect(
      (
        await request('/api/v1/trainer/sessions/training/move', 'POST', {
          version: 1,
          date: '2026-10-23',
          startTime: '18:00',
        })
      ).response.status,
    ).toBe(200);
    expect(sends).not.toHaveBeenCalled();
  });
  it('does not wake delivery for reads or rejected mutations', async () => {
    expect((await request('/api/v1/trainer/overview', 'GET')).tasks).toHaveLength(0);
    const stale = await request('/api/v1/trainer/sessions/training/move', 'POST', {
      version: 9,
      date: '2026-10-23',
      startTime: '18:00',
    });
    expect(stale.response.status).toBe(409);
    expect(stale.tasks).toHaveLength(0);
    await db.prepare('DELETE FROM roles').run();
    const denied = await request('/api/v1/trainer/sessions/training/move', 'POST', {
      version: 1,
      date: '2026-10-23',
      startTime: '18:00',
    });
    expect(denied.response.status).toBe(401);
    expect(denied.tasks).toHaveLength(0);
    expect(sends).not.toHaveBeenCalled();
  });
  it('preserves a saved edit and an uncertain job on provider failure without blind retry', async () => {
    sends.mockRejectedValue(new Error('synthetic transport failure'));
    expect(
      (
        await request('/api/v1/trainer/sessions/training/move', 'POST', {
          version: 1,
          date: '2026-10-23',
          startTime: '18:00',
        })
      ).response.status,
    ).toBe(200);
    expect(await db.prepare("SELECT status FROM outbox_jobs WHERE kind='change'").first()).toEqual({
      status: 'uncertain',
    });
    await scheduled(env, now);
    expect(sends).toHaveBeenCalledTimes(1);
  });
});

describe('public source link', () => {
  it('links to the operator source and refuses credential-bearing or executable URLs', async () => {
    env.SOURCE_URL = 'https://github.com/example/club/tree/v1.0';
    expect((await request('/source', 'GET')).response.headers.get('Location')).toBe(env.SOURCE_URL);
    for (const value of ['javascript:alert(1)', 'https://user:secret@example.org']) {
      env.SOURCE_URL = value;
      expect((await request('/source', 'GET')).response.status).toBe(503);
    }
    expect((await request('/', 'GET')).response.status).toBe(200);
  });
});
