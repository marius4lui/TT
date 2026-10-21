import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { queue, sendOutbox } from '../apps/worker/src/outbox';
import type { Env } from '../apps/worker/src/types';
import type { EvolutionClient } from '@tt/whatsapp';

const group = '123456789@g.us',
  jid = '491701234567@s.whatsapp.net';
const now = Date.parse('2026-10-21T12:00:00Z');
let db: ReturnType<typeof testDb>, env: Env;
const sendText = vi.fn(async (_chat: string, _text: string) => ({ id: 'stats-message' }));
const client = { sendText } as unknown as EvolutionClient;
beforeEach(async () => {
  db = testDb();
  sendText.mockClear();
  env = { DB: db } as unknown as Env;
  await db.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'").run();
  await db
    .prepare("INSERT INTO users(id,jid,display_name,created_at) VALUES('member',?,'Mara',?)")
    .bind(jid, now)
    .run();
  await db
    .prepare("INSERT INTO groups(jid,name,active,created_at) VALUES(?,'Training',1,?)")
    .bind(group, now)
    .run();
  await db
    .prepare("INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?)")
    .bind(group, now)
    .run();
});
afterEach(() => db.close());
async function enqueue(chat = group, text = JSON.stringify({ groupJid: group, months: 6 })) {
  await queue(
    db,
    {
      key: 'statistics:event',
      chat,
      userId: 'member',
      kind: 'statistics',
      text,
      expires: now + 300000,
    },
    now,
  );
}
it('renders at delivery, deduplicates and clears the stored metadata after sending', async () => {
  await enqueue();
  await enqueue();
  expect(await sendOutbox(env, now, client)).toBe(1);
  expect(sendText).toHaveBeenCalledTimes(1);
  expect(sendText.mock.calls[0][1]).not.toContain('groupJid');
  expect(await db.prepare('SELECT text FROM outbox_jobs').first('text')).toBe('');
  expect(await sendOutbox(env, now + 1, client)).toBe(0);
});
it.each(['membership', 'group', 'privacy', 'recipient', 'malformed'])(
  'does not send a pending ranking after access is invalid: %s',
  async (change) => {
    await enqueue(
      change === 'recipient' ? '491700000000@s.whatsapp.net' : group,
      change === 'malformed' ? '{}' : undefined,
    );
    if (change === 'membership') await db.prepare('UPDATE memberships SET active=0').run();
    if (change === 'group') await db.prepare('UPDATE groups SET active=0').run();
    if (change === 'privacy')
      await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    expect(await sendOutbox(env, now, client)).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT status FROM outbox_jobs').first('status')).toBe('cancelled');
  },
);
it('allows a current member private delivery but never sends expired rankings', async () => {
  await enqueue(jid);
  expect(await sendOutbox(env, now, client)).toBe(1);
  await db.prepare('DELETE FROM outbox_jobs').run();
  sendText.mockClear();
  await enqueue();
  expect(await sendOutbox(env, now + 300000, client)).toBe(0);
  expect(sendText).not.toHaveBeenCalled();
});
