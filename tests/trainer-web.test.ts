import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { registerTrainerRoutes } from '../apps/worker/src/trainer';
import { hashToken } from '../apps/worker/src/security';
import type { AppBindings, Env } from '../apps/worker/src/types';

const origin = 'https://tt.bz3.eu',
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
async function createSeries() {
  const res = await request('/series', 'POST', {
    groupJid: group,
    weekday: 5,
    startTime: '18:00',
    endTime: '20:00',
    location: 'Halle',
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; version: number };
}
async function createSession() {
  const res = await request('/sessions', 'POST', {
    groupJid: group,
    date: '2026-10-10',
    startTime: '18:00',
    endTime: '20:00',
    location: 'Halle',
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; version: number };
}
async function sessions(seriesId: string) {
  return (
    await db
      .prepare('SELECT * FROM training_sessions WHERE series_id=? ORDER BY start_at')
      .bind(seriesId)
      .all()
  ).results as {
    id: string;
    local_date: string;
    version: number;
    status: string;
    start_at: number;
  }[];
}

describe('trainer web authorization and settings', () => {
  it('discovers unapproved bot groups once and prevents selecting them before approval', async () => {
    const pendingGroup = '120363999999@g.us',
      bot = '491701234599@s.whatsapp.net';
    await db.prepare("INSERT INTO settings(key,value) VALUES('bot_jid',?)").bind(bot).run();
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { id: group, subject: 'Renamed approved group', participants: [{ id: bot }] },
            { id: pendingGroup, subject: 'Pending group', participants: [{ id: bot }] },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await request('/groups/refresh', 'POST', {})).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await db.prepare('SELECT active FROM groups WHERE jid=?').bind(pendingGroup).first(),
    ).toEqual({ active: 0 });
    expect(await db.prepare('SELECT source,status,group_jid FROM group_requests').first()).toEqual({
      source: 'membership',
      status: 'pending',
      group_jid: pendingGroup,
    });
    const denied = await request('/groups/select', 'POST', { jid: pendingGroup, confirm: true });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: 'group_approval_required' });
    expect((await request('/groups/select', 'POST', { jid: group, confirm: true })).status).toBe(
      200,
    );
    expect(
      await db
        .prepare('SELECT COUNT(*) n FROM memberships WHERE group_jid=? AND active=1')
        .bind(group)
        .first(),
    ).toEqual({ n: 2 });
    await request('/groups/refresh', 'POST', {});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await db.prepare('SELECT COUNT(*) n FROM group_requests').first()).toEqual({ n: 1 });
    expect(
      await db.prepare("SELECT COUNT(*) n FROM outbox_jobs WHERE chat_jid LIKE '%@g.us'").first(),
    ).toEqual({ n: 0 });
  });
  it('allows a trainer who never registered as participant and requires both role and cookie', async () => {
    expect((await request('/overview')).status).toBe(200);
    expect((await request('/overview', 'GET', undefined, { Cookie: '' })).status).toBe(401);
    await db.prepare("UPDATE users SET registered_at=? WHERE id='trainer'").bind(now).run();
    await db.prepare("DELETE FROM roles WHERE user_id='trainer'").run();
    expect((await request('/overview')).status).toBe(403);
  });
  it('rejects cross-site writes, unknown fields, invalid dates and DST ambiguity', async () => {
    expect(
      (await request('/series', 'POST', {}, { Origin: 'https://attacker.invalid' })).status,
    ).toBe(403);
    const data = {
      groupJid: group,
      date: '2026-10-10',
      startTime: '18:00',
      endTime: '20:00',
      location: 'Halle',
    };
    expect((await request('/sessions', 'POST', { ...data, date: '2026-02-30' })).status).toBe(400);
    expect(
      (await request('/sessions', 'POST', { ...data, date: '2026-10-25', startTime: '02:30' }))
        .status,
    ).toBe(400);
    expect((await request('/sessions', 'POST', { ...data, admin: true })).status).toBe(400);
    expect(await db.prepare('SELECT COUNT(*) n FROM training_sessions').first()).toEqual({ n: 0 });
  });
  it('requires explicit confirmation and published privacy before activation', async () => {
    expect((await request('/settings', 'PUT', { enabled: true })).status).toBe(400);
    const blocked = await request('/settings', 'PUT', { enabled: true, confirm: true });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: 'privacy_required' });
    expect(
      (
        await request('/settings', 'PUT', {
          privacyText: 'Verantwortlich ist der Testverein. Kontakt bitte beim Trainer.',
          infoText: 'Training in der Sporthalle, bitte Schuhe mitbringen.',
          enabled: true,
          confirm: true,
        })
      ).status,
    ).toBe(200);
    const data = (await (await request('/overview')).json()) as any;
    expect(data.settings).toMatchObject({
      enabled: true,
      privacyReady: true,
      selectedGroup: group,
    });
  });
  it('records summary opt-in separately from registration with optimistic preference versions', async () => {
    const value = {
      enabled: true,
      offsetMinutes: 10,
      includeAbsent: true,
      includeLate: true,
      includeCounts: true,
      version: 0,
    };
    expect((await request('/summary-preference', 'PUT', value)).status).toBe(200);
    expect((await request('/summary-preference', 'PUT', value)).status).toBe(409);
    expect(
      await db.prepare("SELECT registered_at,reminders FROM users WHERE id='trainer'").first(),
    ).toEqual({ registered_at: null, reminders: 0 });
    expect(
      await db.prepare("SELECT purpose,accepted FROM consents WHERE user_id='trainer'").first(),
    ).toEqual({ purpose: 'trainer_summary', accepted: 1 });
    expect(
      (await request('/summary-preference', 'PUT', { ...value, version: 1, enabled: false }))
        .status,
    ).toBe(200);
  });
  it('rechecks trainer role atomically at commit and rolls back every mutation', async () => {
    const original = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      await db.prepare("DELETE FROM roles WHERE user_id='trainer'").run();
      return original(statements);
    });
    const res = await request('/sessions', 'POST', {
      groupJid: group,
      date: '2026-10-10',
      startTime: '18:00',
      endTime: '20:00',
      location: 'Halle',
    });
    expect(res.status).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) n FROM training_sessions').first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) n FROM audit_log').first()).toEqual({ n: 0 });
  });
  it('provides paused delivery times without private bodies or account secrets', async () => {
    const single = await createSession();
    const res = await request('/overview');
    const data = (await res.json()) as any;
    expect(data.delivery.counts).toEqual({ pending: 0, failed: 0, uncertain: 0 });
    expect(data.delivery.nextMessages).toContainEqual(
      expect.objectContaining({ sessionId: single.id, status: 'paused', kind: 'invite' }),
    );
    expect(JSON.stringify(data)).not.toContain('491701234567');
    expect(JSON.stringify(data)).not.toContain('fake-only');
  });
  it('resumes future untouched scheduled jobs but never uncertain or previously attempted jobs', async () => {
    const s = await createSession();
    await db.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'").run();
    await db
      .prepare(
        `INSERT INTO outbox_jobs(id,dedupe_key,chat_jid,session_id,session_version,kind,text,due_at,expires_at,status,attempts,created_at) VALUES('future','future',?,?,1,'late','future',?,?,'pending',0,?),('attempted','attempted',?,?,1,'late','attempted',?,?,'pending',1,?),('uncertain','uncertain',?,?,1,'late','uncertain',?,?,'uncertain',1,?)`,
      )
      .bind(
        group,
        s.id,
        now + 1000,
        now + 86400_000,
        now,
        group,
        s.id,
        now + 1000,
        now + 86400_000,
        now,
        group,
        s.id,
        now + 1000,
        now + 86400_000,
        now,
      )
      .run();
    expect((await request('/settings', 'PUT', { enabled: false, confirm: true })).status).toBe(200);
    expect((await request('/settings', 'PUT', { enabled: true, confirm: true })).status).toBe(200);
    expect(
      (await db.prepare('SELECT id,status FROM outbox_jobs ORDER BY id').all()).results,
    ).toEqual([
      { id: 'attempted', status: 'cancelled' },
      { id: 'future', status: 'pending' },
      { id: 'uncertain', status: 'uncertain' },
    ]);
  });
});

describe('trainer scheduling mutations', () => {
  it.each(['edit', 'end', 'pause'] as const)(
    'rejects %s if cron inserted an occurrence after its snapshot',
    async (action) => {
      const s = await createSeries(),
        original = db.batch.bind(db);
      vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
        const start = Date.parse('2026-11-27T17:00:00Z');
        await db
          .prepare(
            "INSERT INTO training_sessions(id,series_id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('concurrent',?,?,'2026-11-27',?,?,'Europe/Berlin','Halle',?,?,?)",
          )
          .bind(s.id, group, start, start + 7200_000, start - 86400_000, start - 1800_000, now)
          .run();
        return original(statements);
      });
      const response =
        action === 'edit'
          ? await request(`/series/${s.id}`, 'PATCH', {
              version: 1,
              startTime: '19:00',
              endTime: '21:00',
            })
          : action === 'end'
            ? await request(`/series/${s.id}/end`, 'POST', { version: 1 })
            : await request('/pauses', 'POST', {
                groupJid: group,
                fromDate: '2026-10-09',
                toDate: '2026-12-01',
              });
      expect(response.status).toBe(409);
      expect(
        await db
          .prepare('SELECT version,active FROM training_series WHERE id=?')
          .bind(s.id)
          .first(),
      ).toEqual({ version: 1, active: 1 });
      expect(
        await db
          .prepare("SELECT COUNT(*) n FROM training_sessions WHERE status='cancelled'")
          .first(),
      ).toEqual({ n: 0 });
      expect(await db.prepare('SELECT COUNT(*) n FROM training_exceptions').first()).toEqual({
        n: 0,
      });
    },
  );
  it('creates and edits a weekly series while preserving a separately moved occurrence', async () => {
    const s = await createSeries(),
      rows = await sessions(s.id);
    expect(rows.length).toBeGreaterThan(5);
    const moved = rows[0],
      ordinary = rows[1];
    expect(
      (
        await request(`/sessions/${moved.id}/move`, 'POST', {
          version: 1,
          date: '2026-10-11',
          startTime: '19:00',
        })
      ).status,
    ).toBe(200);
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES(?,'member','yes',?)",
      )
      .bind(ordinary.id, now)
      .run();
    expect(
      (
        await request(`/series/${s.id}`, 'PATCH', {
          version: 1,
          startTime: '19:30',
          endTime: '21:30',
          location: 'Neue Halle',
        })
      ).status,
    ).toBe(200);
    const result = await sessions(s.id);
    expect(result.find((t) => t.id === moved.id)?.start_at).toBe(
      Date.parse('2026-10-11T17:00:00Z'),
    );
    expect(result.find((t) => t.id === ordinary.id)).toMatchObject({
      version: 2,
      start_at: Date.parse('2026-10-16T17:30:00Z'),
    });
    expect(
      await db
        .prepare('SELECT needs_confirmation FROM attendance WHERE session_id=?')
        .bind(ordinary.id)
        .first(),
    ).toEqual({ needs_confirmation: 1 });
    expect(
      (await request(`/series/${s.id}`, 'PATCH', { version: 1, startTime: '20:00' })).status,
    ).toBe(409);
    expect((await request(`/series/${s.id}/end`, 'POST', { version: 2 })).status).toBe(200);
    expect((await sessions(s.id)).every((t) => t.status === 'cancelled')).toBe(true);
  });
  it('moves and cancels a single training, rejects stale versions and sends no uninstructed DM', async () => {
    const s = await createSession();
    expect(
      (
        await request('/sessions', 'POST', {
          groupJid: group,
          date: '2026-10-10',
          startTime: '18:00',
          endTime: '20:00',
          location: 'Halle',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/sessions/${s.id}/move`, 'POST', {
          version: 1,
          date: '2026-10-11',
          startTime: '19:00',
        })
      ).status,
    ).toBe(200);
    expect((await request(`/sessions/${s.id}/cancel`, 'POST', { version: 1 })).status).toBe(409);
    expect((await request(`/sessions/${s.id}/cancel`, 'POST', { version: 2 })).status).toBe(200);
    expect(
      await db
        .prepare('SELECT status,version FROM training_sessions WHERE id=?')
        .bind(s.id)
        .first(),
    ).toEqual({ status: 'cancelled', version: 3 });
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
  });
  it('restores overlapping pauses only after the last pause and preserves independent cancellations/special training', async () => {
    const s = await createSeries(),
      rows = await sessions(s.id),
      special = await createSession();
    const manual = rows[1],
      paused = rows[0];
    expect((await request(`/sessions/${manual.id}/cancel`, 'POST', { version: 1 })).status).toBe(
      200,
    );
    const value = { groupJid: group, fromDate: '2026-10-09', toDate: '2026-10-16' };
    expect((await request('/pauses', 'POST', value)).status).toBe(201);
    expect((await request('/pauses', 'POST', value)).status).toBe(201);
    const exceptions = ((await (await request('/exceptions')).json()) as any).exceptions;
    const pauses = exceptions.filter((e: any) => e.kind === 'pause');
    expect(pauses).toHaveLength(2);
    expect((await request(`/exceptions/${pauses[0].id}`, 'DELETE', { version: 1 })).status).toBe(
      200,
    );
    expect(
      await db.prepare('SELECT status FROM training_sessions WHERE id=?').bind(paused.id).first(),
    ).toEqual({ status: 'cancelled' });
    expect((await request(`/exceptions/${pauses[1].id}`, 'DELETE', { version: 1 })).status).toBe(
      200,
    );
    expect(
      await db
        .prepare('SELECT status,version FROM training_sessions WHERE id=?')
        .bind(paused.id)
        .first(),
    ).toEqual({ status: 'scheduled', version: 3 });
    expect(
      await db.prepare('SELECT status FROM training_sessions WHERE id=?').bind(manual.id).first(),
    ).toEqual({ status: 'cancelled' });
    expect(
      await db.prepare('SELECT status FROM training_sessions WHERE id=?').bind(special.id).first(),
    ).toEqual({ status: 'scheduled' });
  });
  it('does not restore a paused occurrence after its series ended or its version changed independently', async () => {
    const s = await createSeries(),
      rows = await sessions(s.id);
    await request('/pauses', 'POST', {
      groupJid: group,
      fromDate: '2026-10-09',
      toDate: '2026-10-16',
    });
    const e = ((await (await request('/exceptions')).json()) as any).exceptions[0];
    await db
      .prepare('UPDATE training_sessions SET version=version+1 WHERE id=?')
      .bind(rows[0].id)
      .run();
    expect((await request(`/series/${s.id}/end`, 'POST', { version: 1 })).status).toBe(200);
    expect((await request(`/exceptions/${e.id}`, 'DELETE', { version: 1 })).status).toBe(200);
    expect((await sessions(s.id)).every((t) => t.status === 'cancelled')).toBe(true);
  });
  it('restores paused occurrences with the edited series time and retains separate cancellations', async () => {
    const s = await createSeries(),
      rows = await sessions(s.id);
    await request(`/sessions/${rows[1].id}/cancel`, 'POST', { version: 1 });
    await request('/pauses', 'POST', {
      groupJid: group,
      fromDate: '2026-10-09',
      toDate: '2026-10-16',
    });
    expect(
      (
        await request(`/series/${s.id}`, 'PATCH', {
          version: 1,
          startTime: '19:00',
          endTime: '21:00',
        })
      ).status,
    ).toBe(200);
    const exceptions = ((await (await request('/exceptions')).json()) as any).exceptions;
    const pause = exceptions.find((e: any) => e.kind === 'pause');
    expect(
      (await request(`/exceptions/${pause.id}`, 'DELETE', { version: pause.version })).status,
    ).toBe(200);
    expect(
      await db
        .prepare('SELECT status,start_at,version FROM training_sessions WHERE id=?')
        .bind(rows[0].id)
        .first(),
    ).toEqual({ status: 'scheduled', start_at: Date.parse('2026-10-09T17:00:00Z'), version: 4 });
    expect(
      await db.prepare('SELECT status FROM training_sessions WHERE id=?').bind(rows[1].id).first(),
    ).toEqual({ status: 'cancelled' });
  });
});

describe('attendance overview and manual corrections', () => {
  it('shows unanswered members and corrects attendance using session and response versions', async () => {
    const s = await createSession();
    let data = (await (await request(`/sessions/${s.id}/attendance`)).json()) as any;
    expect(data.counts).toEqual({ yes: 0, no: 0, late: 0, unanswered: 2, total: 2 });
    expect(data.participants.map((p: any) => p.name)).toEqual(['Ada', 'Ben']);
    const value = { sessionVersion: 1, expectedUpdatedAt: 0, response: 'late', minutes: 15 };
    expect((await request(`/sessions/${s.id}/attendance/member`, 'POST', value)).status).toBe(200);
    expect((await request(`/sessions/${s.id}/attendance/member`, 'POST', value)).status).toBe(409);
    data = (await (await request(`/sessions/${s.id}/attendance`)).json()) as any;
    expect(data.counts).toEqual({ yes: 1, no: 0, late: 1, unanswered: 1, total: 2 });
    await db
      .prepare('UPDATE attendance SET needs_confirmation=1 WHERE session_id=?')
      .bind(s.id)
      .run();
    data = (await (await request(`/sessions/${s.id}/attendance`)).json()) as any;
    expect(data.counts).toEqual({ yes: 0, no: 0, late: 0, unanswered: 2, total: 2 });
    expect((await request(`/sessions/${s.id}/attendance/keeper`, 'POST', value)).status).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
  });
  it('detects membership removal between reading and committing correction', async () => {
    const s = await createSession(),
      original = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      await db.prepare("UPDATE memberships SET active=0 WHERE user_id='member'").run();
      return original(statements);
    });
    expect(
      (
        await request(`/sessions/${s.id}/attendance/member`, 'POST', {
          sessionVersion: 1,
          expectedUpdatedAt: 0,
          response: 'yes',
        })
      ).status,
    ).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) n FROM attendance').first()).toEqual({ n: 0 });
  });
});
