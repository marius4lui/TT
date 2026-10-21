import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { issueMagicLogin } from '../apps/worker/src/magic-login';
import { planLoginMessageEdits } from '../apps/worker/src/login-messages';
import { sendOutbox } from '../apps/worker/src/outbox';
import { app, scheduled } from '../apps/worker/src/index';
import type { BotContext, Env, User } from '../apps/worker/src/types';
let db: ReturnType<typeof testDb>,
  env: Env,
  now: number,
  fetcher: ReturnType<typeof vi.fn>,
  ctx: BotContext;
beforeEach(async () => {
  db = testDb();
  now = Date.parse('2026-10-21T08:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://provider.invalid',
    EVOLUTION_INSTANCE: 'test',
    EVOLUTION_API_KEY: 'fixture',
  };
  fetcher = vi.fn(async () => new Response(JSON.stringify({ key: { id: crypto.randomUUID() } })));
  vi.stubGlobal('fetch', fetcher);
  const user: User = {
    id: 'trainer',
    jid: '491701111111@s.whatsapp.net',
    display_name: 'Trainer',
    created_at: now,
    registered_at: now,
    reminders: 0,
  };
  await db
    .prepare('INSERT INTO users(id,jid,registered_at,created_at) VALUES(?,?,?,?)')
    .bind(user.id, user.jid, now, now)
    .run();
  ctx = {
    env,
    user,
    chatJid: user.jid,
    isGroup: false,
    text: '/login',
    eventId: 'issue',
    timestamp: now,
    now,
    origin: 'https://tt.example.org',
  };
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function issue() {
  const reply = await issueMagicLogin(ctx);
  await sendOutbox(env, now);
  return reply[0].match(/#([a-f0-9]{48})/)![1];
}
describe('durable login message replacement', () => {
  it('edits immediately after redemption, without waiting for another WhatsApp event', async () => {
    const token = await issue();
    const original = JSON.parse(fetcher.mock.calls[0][1].body);
    const tasks: Promise<unknown>[] = [];
    const response = await app.fetch(
      new Request(ctx.origin + '/api/v1/auth/magic/finish', {
        method: 'POST',
        headers: { Origin: ctx.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
      env,
      { waitUntil: (p: Promise<unknown>) => tasks.push(p) } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(200);
    await Promise.all(tasks);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('/chat/updateMessage/test');
    const edit = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(edit).toMatchObject({
      number: ctx.chatJid,
      key: { fromMe: true, remoteJid: ctx.chatJid },
    });
    expect(edit.text).toContain(ctx.origin + '/login');
    expect(edit.text).not.toContain(token);
    expect(original.text).toContain(token);
    await planLoginMessageEdits(db, now);
    await sendOutbox(env, now);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await db.prepare('SELECT COUNT(*) n FROM messages').first('n')).toBe(1);
  });
  it('replaces an expired link on the scheduled pass, but not before five minutes', async () => {
    await issue();
    now += 299999;
    await planLoginMessageEdits(db, now);
    await sendOutbox(env, now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now++;
    await scheduled(env, now);
    expect(fetcher.mock.calls[1][0]).toContain('/chat/updateMessage/test');
    expect(
      await db.prepare("SELECT status FROM outbox_jobs WHERE kind='login_edit'").first('status'),
    ).toBe('sent');
  });
  it('does not repost a login after an ambiguous edit response', async () => {
    await issue();
    await db.prepare("UPDATE auth_magic_links SET state='used'").run();
    await planLoginMessageEdits(db, now);
    fetcher.mockRejectedValueOnce(new Error('network lost'));
    await sendOutbox(env, now);
    await planLoginMessageEdits(db, now);
    await sendOutbox(env, now);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      await db.prepare("SELECT status FROM outbox_jobs WHERE kind='login_edit'").first('status'),
    ).toBe('uncertain');
  });
});
