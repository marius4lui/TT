import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { testDb } from './helpers/db';
import { cleanup } from '../apps/worker/src/inbox';
import { handleAccountMessage, registerAuthRoutes, SESSION_COOKIE } from '../apps/worker/src/auth';
import { hashToken, randomToken } from '../apps/worker/src/security';
import type { AppBindings, BotContext, Env, User } from '../apps/worker/src/types';

const day = 86400000;
let db: ReturnType<typeof testDb>;
let now: number;
let env: Env;
beforeEach(async () => {
  db = testDb();
  now = Date.now();
  env = { DB: db } as unknown as Env;
  for (const id of ['member', 'other', 'trainer'])
    await db
      .prepare('INSERT INTO users(id,jid,display_name,registered_at,created_at) VALUES(?,?,?,?,?)')
      .bind(id, `${id}@s.whatsapp.net`, id, now, now)
      .run();
  await db
    .prepare("INSERT INTO groups(jid,name,active,created_at) VALUES('g','Group',1,?)")
    .bind(now)
    .run();
});
afterEach(() => db.close());
async function fixture(id: string, end: number, user = 'member') {
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES(?,'g','2026-01-01',?,?,'Europe/Berlin','Hall',0,0,?)",
    )
    .bind(id, end - 3600000, end, now)
    .run();
  await db
    .prepare("INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES(?,?,'yes',?)")
    .bind(id, user, now)
    .run();
  await db
    .prepare(
      "INSERT INTO session_presence(session_id,user_id,state,updated_at,confirmed_by) VALUES(?,?,'absent',?,'trainer')",
    )
    .bind(id, user, now)
    .run();
}
async function cookie() {
  const token = randomToken();
  await db
    .prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)',
    )
    .bind(await hashToken(token), 'member', now, now + day, now)
    .run();
  return `${SESSION_COOKIE}=${token}`;
}

describe('statistics personal data lifecycle', () => {
  it('keeps annual history and removes both data types only beyond 400 days', async () => {
    await fixture('old', now - 400 * day - 1);
    await fixture('boundary', now - 400 * day);
    await fixture('year', now - 365 * day);
    await cleanup(db, now);
    for (const table of ['attendance', 'session_presence']) {
      const rows = await db.prepare(`SELECT session_id FROM ${table} ORDER BY session_id`).all();
      expect(rows.results).toEqual([{ session_id: 'boundary' }, { session_id: 'year' }]);
    }
    expect(
      await db.prepare("SELECT id FROM training_sessions WHERE id='old'").first(),
    ).toBeTruthy();
  });

  it('exports only the requesting member corrections in WhatsApp and HTTP', async () => {
    await fixture('own', now - day);
    await fixture('someone-else', now - day, 'other');
    await db
      .prepare("INSERT INTO group_first_names VALUES('g','member','Anna',?),('g','other','Ben',?)")
      .bind(now, now)
      .run();
    const user = (await db.prepare("SELECT * FROM users WHERE id='member'").first<User>())!;
    const ctx: BotContext = {
      env,
      user,
      text: '/daten',
      chatJid: user.jid,
      isGroup: false,
      eventId: 'export',
      timestamp: now,
      now,
      origin: 'https://tt.example.org',
    };
    const chat = JSON.parse((await handleAccountMessage(ctx))!.join(''));
    const app = new Hono<AppBindings>();
    registerAuthRoutes(app);
    const response = await app.request(
      '/api/v1/account/data',
      { headers: { Cookie: await cookie() } },
      env,
    );
    expect(response.status).toBe(200);
    const web = (await response.json()) as { presence: unknown[]; firstNames: unknown[] };
    const expected = [
      { session_id: 'own', state: 'absent', updated_at: now, confirmed_by: 'trainer' },
    ];
    expect(chat.presence).toEqual(expected);
    expect(web.presence).toEqual(expected);
    expect(chat.firstNames).toEqual([{ group_jid: 'g', first_name: 'Anna', updated_at: now }]);
    expect(web.firstNames).toEqual(chat.firstNames);
  });

  it('clears trainer attribution without losing member correction, then cascades member deletion', async () => {
    await fixture('own', now - day);
    await db.prepare("DELETE FROM users WHERE id='trainer'").run();
    expect(
      await db
        .prepare("SELECT state,confirmed_by FROM session_presence WHERE user_id='member'")
        .first(),
    ).toEqual({ state: 'absent', confirmed_by: null });
    await db.prepare("DELETE FROM users WHERE id='member'").run();
    expect(await db.prepare('SELECT * FROM session_presence').first()).toBeNull();
    expect(await db.prepare('SELECT * FROM attendance').first()).toBeNull();
  });

  it('cascades session deletion without leaving a personal correction', async () => {
    await fixture('own', now - day);
    await db.prepare("DELETE FROM training_sessions WHERE id='own'").run();
    expect(await db.prepare('SELECT * FROM session_presence').first()).toBeNull();
  });
});
