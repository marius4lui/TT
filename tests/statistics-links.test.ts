import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { cleanup } from '../apps/worker/src/inbox';
import { app } from '../apps/worker/src/index';
import { createStatisticsLink, linkedStatisticsReply } from '../apps/worker/src/statistics-links';
import { statisticsFirstName } from '../apps/worker/src/statistics';
import { processMessage } from '../apps/worker/src/bot';
import type { Env } from '../apps/worker/src/types';
let db: ReturnType<typeof testDb>, env: Env;
const now = Date.parse('2026-10-21T12:00:00Z'),
  group = '123456789@g.us';
beforeEach(async () => {
  db = testDb();
  env = { DB: db } as unknown as Env;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db.prepare("INSERT INTO groups VALUES(?,'Private Club',1,?)").bind(group, now).run();
  for (let i = 0; i < 6; i++) {
    await db
      .prepare('INSERT INTO users(id,jid,display_name,created_at) VALUES(?,?,?,?)')
      .bind('u' + i, `49170111111${i}@s.whatsapp.net`, 'Secret Surname' + i, now)
      .run();
    await db
      .prepare('INSERT INTO memberships VALUES(?,?,1,?)')
      .bind(group, 'u' + i, now)
      .run();
    await db
      .prepare('INSERT INTO group_first_names VALUES(?,?,?,?)')
      .bind(group, 'u' + i, ['Anna', 'Ben', 'Clara', 'David', 'Emil', 'Frieda'][i], now)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('past',?,'2026-10-20',?,?,'Europe/Berlin','Halle',0,0,0)",
    )
    .bind(group, now - 86400000, now - 80000000)
    .run();
  await db
    .prepare(
      "INSERT INTO attendance(session_id,user_id,response,updated_at) SELECT 'past',id,'yes',? FROM users",
    )
    .bind(now)
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
const issue = () =>
  createStatisticsLink(
    db,
    { group_jid: group, requester_id: 'u0', practice_id: null, practice_version: null, months: 6 },
    now,
  );
const open = (url: string) => app.fetch(new Request(url), env);
it('sends only three entries and a short link, while the full table contains everyone with no surnames or ids', async () => {
  const text = await linkedStatisticsReply(db, group, 'u0', now);
  expect(text).toContain('Anna');
  expect(text).not.toContain('Frieda');
  expect(text.length).toBeLessThan(450);
  expect(text).toContain('Weitere punktgleiche');
  const url = text.match(/https:\/\/\S+\/s\/[\w-]{22}/)![0];
  const response = await open(url);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('Frieda');
  expect(html).not.toContain('Surname');
  expect(html).not.toContain('@s.whatsapp.net');
  expect(html).not.toContain(group);
  expect(html).not.toContain('Private Club');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  const stored = await db
    .prepare('SELECT token_hash FROM statistics_links')
    .first<string>('token_hash');
  expect(stored).toHaveLength(64);
  expect(stored).not.toContain(url.split('/').pop());
  expect((await open(url + '?months=12')).status).toBe(200);
  expect((await open(url + '?months=2')).status).toBe(404);
});
it.each(['expiry', 'membership', 'group', 'privacy', 'deletion'])(
  'revokes access after %s',
  async (change) => {
    const url = await issue();
    if (change === 'expiry') vi.mocked(Date.now).mockReturnValue(now + 7 * 86400000);
    if (change === 'membership')
      await db.prepare("UPDATE memberships SET active=0 WHERE user_id='u0'").run();
    if (change === 'group') await db.prepare('UPDATE groups SET active=0').run();
    if (change === 'privacy')
      await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    if (change === 'deletion') await db.prepare("DELETE FROM users WHERE id='u0'").run();
    expect((await open(url)).status).toBe(404);
  },
);
it('rejects unknown links and never issues one for a nonmember', async () => {
  expect((await open('https://tt.example.org/s/' + 'x'.repeat(22))).status).toBe(404);
  await db.prepare("DELETE FROM memberships WHERE user_id='u0'").run();
  await expect(issue()).rejects.toThrow('statistics_unavailable');
});
it('keeps demo links separate and revokes them on restart', async () => {
  await db.prepare("INSERT INTO roles VALUES('u0','admin',?)").bind(now).run();
  await db
    .prepare(
      "INSERT INTO practice_groups(id,owner_id,subject,status,phase,version,expires_at,created_at) VALUES('demo','u0','Demo','ready','active',2,?,?)",
    )
    .bind(now + 3600000, now)
    .run();
  const url = await createStatisticsLink(
    db,
    {
      group_jid: null,
      requester_id: null,
      practice_id: 'demo',
      practice_version: 2,
      months: 6,
      expires_at: now + 3600000,
    },
    now,
  );
  const html = await (await open(url)).text();
  expect(html).toContain('Alle Namen und Werte sind erfunden');
  expect(html).toContain('Charlie');
  expect(html).not.toContain('Frieda');
  await db.prepare('UPDATE practice_groups SET version=3').run();
  expect((await open(url)).status).toBe(404);
});
it('uses first tokens only and rejects ambiguous or unsafe names', () => {
  expect(statisticsFirstName('Jörg Müller')).toBe('Jörg');
  expect(statisticsFirstName('Anna-Lena Meier')).toBe('Anna-Lena');
  for (const bad of [
    'Müller, Max',
    '<img src=x>',
    '+49123456',
    'https://example.org',
    'Max\nMüller',
    '🤖',
    'Dr. Müller',
  ])
    expect(statisticsFirstName(bad)).toBe('Mitglied');
});
it('records only a group-supplied first token, not a private display name or replayed old name', async () => {
  await db.prepare("DELETE FROM group_first_names WHERE user_id='u0'").run();
  const event = {
    id: 'name',
    chatJid: group,
    senderJid: '491701111110@s.whatsapp.net',
    aliases: [],
    displayName: 'Anne Müller',
    timestamp: now,
    isGroup: true,
    text: 'Hallo',
  };
  await processMessage(env, event, now);
  expect(
    await db
      .prepare("SELECT first_name FROM group_first_names WHERE user_id='u0'")
      .first('first_name'),
  ).toBe('Anne');
  await processMessage(
    env,
    { ...event, id: 'older', displayName: 'Berta Schmidt', timestamp: now - 1000 },
    now,
  );
  await processMessage(
    env,
    {
      ...event,
      id: 'private',
      isGroup: false,
      chatJid: event.senderJid,
      displayName: 'Carla Schmidt',
      timestamp: now + 1000,
    },
    now + 1000,
  );
  expect(
    await db
      .prepare("SELECT first_name FROM group_first_names WHERE user_id='u0'")
      .first('first_name'),
  ).toBe('Anne');
});

it('removes expired links during cleanup and names when the person is deleted', async () => {
  await issue();
  await db.prepare('UPDATE statistics_links SET expires_at=?').bind(now).run();
  await cleanup(db, now);
  expect(await db.prepare('SELECT COUNT(*) n FROM statistics_links').first('n')).toBe(0);
  await db.prepare("DELETE FROM users WHERE id='u0'").run();
  expect(await db.prepare("SELECT * FROM group_first_names WHERE user_id='u0'").first()).toBeNull();
});
