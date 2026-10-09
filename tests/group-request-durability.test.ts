import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { resolveUser } from '../apps/worker/src/auth';
import {
  requestGroupLink,
  approveGroupRequest,
  observeBotGroup,
} from '../apps/worker/src/group-requests';
import type { Env, User } from '../apps/worker/src/types';
import type { EvolutionClient } from '@tt/whatsapp';

let db: ReturnType<typeof testDb>, env: Env, owner: User;
const now = 1781000000000,
  bot = '491701111111@s.whatsapp.net',
  group = '120363123456@g.us';
const link = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
function provider() {
  return {
    inviteInfo: vi.fn(async () => ({ id: group, subject: 'TT' })),
    acceptInvite: vi.fn(async () => group),
    fetchGroups: vi.fn(async () => [{ id: group, subject: 'TT', participants: [{ id: bot }] }]),
  };
}
const client = (p: ReturnType<typeof provider>) => p as unknown as EvolutionClient;
const trainer = () => ({ user: owner, role: 'owner' as const, authenticatedAt: now });
beforeEach(async () => {
  db = testDb();
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://fixture.invalid',
    EVOLUTION_INSTANCE: 'fixture',
    EVOLUTION_API_KEY: 'fixture',
  };
  owner = (await resolveUser(env, '491701234567@s.whatsapp.net', [], 'Ma*rius\n_Team_', now))!;
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?)")
    .bind(owner.id, now)
    .run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('bot_jid',?)").bind(bot).run();
  await db
    .prepare(
      "INSERT INTO settings(key,value) VALUES('bot_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .bind('Marius\n*Bot*')
    .run();
});
afterEach(() => db.close());
it.each(['link', 'membership'])(
  'queues one atomic welcome after %s approval and no duplicate requester notification',
  async (source) => {
    const p = provider();
    let id: string;
    if (source === 'link') {
      id = await requestGroupLink(env, owner.id, link, now, client(p));
      expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(0);
    } else {
      await observeBotGroup(env, group, now, client(p));
      id = (await db.prepare('SELECT id FROM group_requests').first<string>('id'))!;
    }
    await approveGroupRequest(env, id, trainer(), false, now + 1, client(p));
    await approveGroupRequest(env, id, trainer(), false, now + 2, client(p));
    await observeBotGroup(env, group, now + 3, client(p));
    const jobs = (
      await db
        .prepare('SELECT text,kind,chat_jid FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`group-welcome:${group}`)
        .all<{ text: string; kind: string; chat_jid: string }>()
    ).results;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'reply', chat_jid: group });
    expect(jobs[0].text).toContain('*Marius Bot*');
    expect(jobs[0].text).toContain('*Ma rius Team*');
    expect(jobs[0].text).toContain('_Powered by KMUC_');
  },
);
it('renews an expired pending invitation with verified metadata', async () => {
  const p = provider(),
    id = await requestGroupLink(env, owner.id, link, now, client(p));
  const later = now + 8 * 86400000;
  expect(await requestGroupLink(env, owner.id, link, later, client(p))).toBe(id);
  expect(p.inviteInfo).toHaveBeenCalledTimes(2);
  await approveGroupRequest(env, id, trainer(), false, later + 1, client(p));
  expect(
    await db.prepare('SELECT status FROM group_requests WHERE id=?').bind(id).first('status'),
  ).toBe('approved');
});
it('fences an earlier approval worker after another worker takes its lease', async () => {
  const p = provider(),
    id = await requestGroupLink(env, owner.id, link, now, client(p));
  p.fetchGroups.mockImplementationOnce(async () => {
    await db
      .prepare("UPDATE group_requests SET status='joining',updated_at=? WHERE id=?")
      .bind(now + 200000, id)
      .run();
    return [{ id: group, subject: 'TT', participants: [{ id: bot }] }];
  });
  await expect(
    approveGroupRequest(env, id, trainer(), false, now + 1, client(p)),
  ).rejects.toThrow();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM groups').first('n')).toBe(0);
  expect(
    await db
      .prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE dedupe_key LIKE 'group-welcome:%'")
      .first('n'),
  ).toBe(0);
  expect(
    await db.prepare('SELECT status,updated_at FROM group_requests WHERE id=?').bind(id).first(),
  ).toEqual({ status: 'joining', updated_at: now + 200000 });
});
