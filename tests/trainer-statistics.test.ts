import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { registerTrainerRoutes } from '../apps/worker/src/trainer';
import { hashToken } from '../apps/worker/src/security';
import type { AppBindings, Env } from '../apps/worker/src/types';

const origin = 'https://tt.example.org',
  group = '120363123456@g.us',
  now = Date.parse('2026-10-09T12:00:00Z');
let db: ReturnType<typeof testDb>, env: Env, app: Hono<AppBindings>;
const cookie = `__Host-tt-session=${'a'.repeat(64)}`;
beforeEach(async () => {
  db = testDb();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'test',
    EVOLUTION_API_KEY: 'fake-only',
  };
  app = new Hono<AppBindings>();
  registerTrainerRoutes(app);
  await db
    .prepare(
      "INSERT INTO users(id,jid,display_name,created_at) VALUES('trainer','491701234567@s.whatsapp.net','Trainer',?),('member','491701234568@s.whatsapp.net','Ada',?),('other','491701234569@s.whatsapp.net','Ben',?),('keeper','491701234570@s.whatsapp.net','Keeper',?)",
    )
    .bind(now, now, now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO roles(user_id,role,created_at) VALUES('keeper','owner',?),('trainer','admin',?)",
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at,last_seen_at) VALUES(?,?,?, ?,?)',
    )
    .bind(await hashToken('a'.repeat(64)), 'trainer', now, now + 86400_000, now)
    .run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', now)
    .run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('selected_group',?)").bind(group).run();
  await db
    .prepare(
      "INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?),(?,'other',1,?)",
    )
    .bind(group, now, group, now)
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.fetch(
    new Request(`${origin}/api/v1/trainer${path}`, {
      method,
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
async function historicalSession(id = 'past', end = now - 3600000, status = 'scheduled') {
  await db
    .prepare(
      `INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,status,created_at)
    VALUES(?,?,'2026-10-09',?,?,'Europe/Berlin','Halle',0,0,?,0)`,
    )
    .bind(id, group, end - 3600000, end, status)
    .run();
}
const correction = { sessionVersion: 1, expectedUpdatedAt: 0, state: 'absent' };
describe('historical participation corrections', () => {
  it('lists completed sessions and keeps future/cancelled sessions out', async () => {
    await historicalSession();
    await historicalSession('future', now + 3600000);
    await historicalSession('cancelled', now - 3600000, 'cancelled');
    const data = (await (await request('/history')).json()) as any;
    expect(data.sessions.map((s: any) => s.id)).toEqual(['past']);
    expect(data.nextOffset).toBeNull();
    expect((await request('/history?offset=-1')).status).toBe(400);
  });
  it('keeps corrections separate from RSVP, supports resetting, and creates no messages', async () => {
    await historicalSession();
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES('past','member','yes',42)",
      )
      .run();
    let data = (await (await request('/sessions/past/presence')).json()) as any;
    expect(data.participants.find((p: any) => p.userId === 'member')).toMatchObject({
      state: 'automatic',
      response: 'yes',
      updatedAt: 0,
    });
    expect((await request('/sessions/past/presence/member', 'POST', correction)).status).toBe(200);
    expect((await request('/sessions/past/presence/member', 'POST', correction)).status).toBe(409);
    expect(
      await db.prepare("SELECT response,updated_at FROM attendance WHERE user_id='member'").first(),
    ).toEqual({ response: 'yes', updated_at: 42 });
    data = (await (await request('/sessions/past/presence')).json()) as any;
    const member = data.participants.find((p: any) => p.userId === 'member');
    expect(member.state).toBe('absent');
    expect(
      (
        await request('/sessions/past/presence/member', 'POST', {
          ...correction,
          state: 'automatic',
          expectedUpdatedAt: member.updatedAt,
        })
      ).status,
    ).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
    expect(
      await db
        .prepare("SELECT COUNT(*) n FROM audit_log WHERE action='trainer:presence.correct'")
        .first(),
    ).toEqual({ n: 2 });
  });
  it('rejects future, cancelled, stale session, non-member and unauthenticated edits', async () => {
    await historicalSession();
    await historicalSession('future', now + 3600000);
    await historicalSession('cancelled', now - 3600000, 'cancelled');
    for (const id of ['future', 'cancelled'])
      expect((await request(`/sessions/${id}/presence/member`, 'POST', correction)).status).toBe(
        409,
      );
    expect(
      (
        await request('/sessions/past/presence/member', 'POST', {
          ...correction,
          sessionVersion: 2,
        })
      ).status,
    ).toBe(409);
    expect((await request('/sessions/past/presence/keeper', 'POST', correction)).status).toBe(409);
    expect(
      (await request('/sessions/past/presence/member', 'POST', correction, { Cookie: '' })).status,
    ).toBe(401);
    expect(
      (
        await request('/sessions/past/presence/member', 'POST', correction, {
          Origin: 'https://evil.invalid',
        })
      ).status,
    ).toBe(403);
    await db.prepare("DELETE FROM roles WHERE user_id='trainer'").run();
    expect((await request('/sessions/past/presence/member', 'POST', correction)).status).toBe(401);
    expect(await db.prepare('SELECT COUNT(*) n FROM session_presence').first()).toEqual({ n: 0 });
  });
  it('shows departed historical participants read-only', async () => {
    await historicalSession();
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES('past','member','yes',42)",
      )
      .run();
    await db.prepare("UPDATE memberships SET active=0 WHERE user_id='member'").run();
    const data = (await (await request('/sessions/past/presence')).json()) as any;
    expect(data.participants.find((p: any) => p.userId === 'member')).toMatchObject({
      editable: 0,
      response: 'yes',
    });
    expect((await request('/sessions/past/presence/member', 'POST', correction)).status).toBe(409);
  });
  it('excludes reserved practice groups and bot identities', async () => {
    await historicalSession();
    await db
      .prepare("INSERT INTO settings(key,value) VALUES('bot_jid','491701234568@s.whatsapp.net')")
      .run();
    const data = (await (await request('/sessions/past/presence')).json()) as any;
    expect(data.participants.some((p: any) => p.userId === 'member')).toBe(false);
    expect((await request('/sessions/past/presence/member', 'POST', correction)).status).toBe(409);
    await db.prepare('UPDATE groups SET active=0 WHERE jid=?').bind(group).run();
    await db
      .prepare(
        "INSERT INTO practice_groups(id,group_jid,subject,created_at) VALUES('practice',?,'Practice',0)",
      )
      .bind(group)
      .run();
    expect((await request('/sessions/past/presence')).status).toBe(409);
    expect((await request('/sessions/past/presence/other', 'POST', correction)).status).toBe(409);
    expect(((await (await request('/history')).json()) as any).sessions).toEqual([]);
  });
  it('paginates equal-ended sessions without dropping records', async () => {
    for (let i = 0; i < 52; i++) await historicalSession('past' + String(i).padStart(2, '0'));
    const first = (await (await request('/history')).json()) as any;
    const second = (await (await request('/history?offset=' + first.nextOffset)).json()) as any;
    expect(new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size).toBe(52);
    expect(second.nextOffset).toBeNull();
  });
});
