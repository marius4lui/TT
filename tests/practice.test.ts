import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../apps/worker/src/index';
import { hashToken } from '../apps/worker/src/security';
import { processMessage } from '../apps/worker/src/bot';
import { acceptWebhook, cleanup } from '../apps/worker/src/inbox';
import { sendOutbox } from '../apps/worker/src/outbox';
import { testDb } from './helpers/db';
import type { Env } from '../apps/worker/src/types';
import type { MessageEvent } from '@tt/whatsapp';
const origin = 'https://tt.example.org',
  group = '120363444444@g.us',
  jid = '491701111111@s.whatsapp.net';
let db: ReturnType<typeof testDb>,
  env: Env,
  now: number,
  fetcher: ReturnType<typeof vi.fn>,
  tasks: Promise<unknown>[];
beforeEach(async () => {
  db = testDb();
  now = Date.parse('2026-10-21T08:00:00Z');
  tasks = [];
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://provider.invalid',
    EVOLUTION_INSTANCE: 'test',
    EVOLUTION_API_KEY: 'fixture',
  };
  fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('/group/create/') ? { id: group } : { key: { id: crypto.randomUUID() } },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  await db.prepare("INSERT INTO users(id,jid,created_at) VALUES('owner',?,?)").bind(jid, now).run();
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES('owner','admin',?)")
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at,last_seen_at) VALUES(?,'owner',?,?,?)",
    )
    .bind(await hashToken('a'.repeat(64)), now, now + 86400000, now)
    .run();
});
afterEach(async () => {
  await Promise.allSettled(tasks);
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function request(path = '', body?: unknown, cookie = true) {
  const response = await app.fetch(
    new Request(origin + '/api/v1/trainer/practice' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: '__Host-tt-session=' + 'a'.repeat(64) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    { waitUntil: (p: Promise<unknown>) => tasks.push(p) } as unknown as ExecutionContext,
  );
  await Promise.all(tasks);
  tasks = [];
  return response;
}
async function start() {
  expect((await request('/create', { confirm: true })).status).toBe(200);
  expect((await request('/action', { action: 'start', version: 0 })).status).toBe(200);
  now += 1000;
}
async function incoming(text: string, extras: Partial<MessageEvent> = {}) {
  await processMessage(
    env,
    {
      id: crypto.randomUUID(),
      chatJid: group,
      senderJid: jid,
      aliases: [jid],
      displayName: 'Trainerin',
      timestamp: now++,
      isGroup: true,
      text,
      ...extras,
    },
    now,
  );
}
async function state() {
  return (await (await request()).json()) as {
    group: { version: number; phase: string; status: string; delivery: string };
    participants: { attendance: string; late: boolean; minutes?: number }[];
  };
}

describe('trainer-friendly isolated practice', () => {
  it('requires a trainer session and explicit creation, and creates only one group', async () => {
    expect((await request('', undefined, false)).status).toBe(401);
    expect((await request('/create', {})).status).toBe(400);
    await start();
    await request('/create', { confirm: true });
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/group/create/'))).toHaveLength(1);
    expect((await state()).group).toMatchObject({ phase: 'active', delivery: 'sent' });
    expect(await db.prepare('SELECT COUNT(*) n FROM groups').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) n FROM training_sessions').first('n')).toBe(0);
  });
  it('keeps attendance, language corrections and clock reactions separate while production is paused', async () => {
    await start();
    await incoming('Kann doch');
    expect((await state()).participants).toHaveLength(0);
    await incoming('Kann nicht');
    expect((await state()).participants[0].attendance).toBe('no');
    await incoming('Kann doch');
    expect((await state()).participants[0].attendance).toBe('yes');
    await incoming('Ich komme fünf Minuten später');
    expect((await state()).participants[0]).toMatchObject({
      attendance: 'yes',
      late: true,
      minutes: 5,
    });
    await incoming('Ich komme doch pünktlich');
    expect((await state()).participants[0].late).toBe(false);
    expect(await db.prepare('SELECT COUNT(*) n FROM attendance').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) n FROM memberships').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) n FROM users').first('n')).toBe(1);
    const payload = {
      instance: 'test',
      event: 'MESSAGES_UPSERT',
      data: {
        key: { id: 'paused-incoming', remoteJid: group, participant: jid, fromMe: false },
        messageTimestamp: Math.floor(now / 1000),
        message: { conversation: 'Kann nicht' },
      },
    };
    expect(await acceptWebhook(env, payload, now)).toBe(1);
  });
  it('requires current invitations and ignores delayed responses after moving the exercise', async () => {
    await start();
    const invite = await db
      .prepare("SELECT provider_id FROM outbox_jobs WHERE kind='practice_invite'")
      .first<string>('provider_id');
    await incoming('Kann doch', { quotedId: invite! });
    expect((await state()).participants[0].attendance).toBe('yes');
    await request('/action', { action: 'move', version: 1 });
    await incoming('Kann nicht', { quotedId: invite! });
    await incoming('Kann nicht', { timestamp: now - 10000 });
    expect((await state()).participants).toHaveLength(0);
    expect((await request('/action', { action: 'cancel', version: 1 })).status).toBe(409);
    await incoming('Kann doch');
    expect((await state()).participants).toHaveLength(0);
    await incoming('Ich komme');
    expect((await state()).participants[0].attendance).toBe('yes');
  });
  it('preserves the invitation and attendance when asking about lateness, and supports reaction removal', async () => {
    await start();
    const invite = (await db
      .prepare("SELECT provider_id FROM outbox_jobs WHERE kind='practice_invite'")
      .first<string>('provider_id'))!;
    await incoming('', { reaction: { targetId: invite, emoji: '👍🏽' } });
    await request('/action', { action: 'late', version: 1 });
    const late = (await db
      .prepare("SELECT provider_id FROM outbox_jobs WHERE kind='practice_late'")
      .first<string>('provider_id'))!;
    await incoming('', { reaction: { targetId: late, emoji: '⏰' } });
    expect((await state()).participants[0].late).toBe(true);
    await incoming('', { reaction: { targetId: late, emoji: '' } });
    expect((await state()).participants[0]).toMatchObject({ attendance: 'yes', late: false });
    await incoming('', { reaction: { targetId: invite, emoji: '👎' } });
    expect((await state()).participants[0].attendance).toBe('no');
  });
  it('ends exercises, rejects further messages and erases their responses', async () => {
    await start();
    await incoming('Ich komme');
    await request('/action', { action: 'stop', version: 1 });
    await incoming('Ich komme');
    expect((await state()).participants).toHaveLength(0);
    expect((await state()).group.phase).toBe('stopped');
    await request('/action', { action: 'start', version: 2 });
    await incoming('Kann nicht');
    now += 3600001;
    await incoming('Ich komme');
    await cleanup(db, now);
    expect(await db.prepare('SELECT COUNT(*) n FROM practice_attendance').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) n FROM groups').first('n')).toBe(0);
  });
  it('does not resend or create a second group after an uncertain provider result', async () => {
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    await request('/create', { confirm: true });
    expect((await state()).group.status).toBe('uncertain');
    await request('/create', { confirm: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const subject = await db.prepare('SELECT subject FROM practice_groups').first('subject');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: group, subject, participants: [] }])),
    );
    expect((await request('/reconcile', {})).status).toBe(200);
    expect((await state()).group.status).toBe('ready');
  });
  it('blocks sends when the owning trainer loses access and excludes practice groups from normal discovery', async () => {
    await start();
    const subject = await db.prepare('SELECT subject FROM practice_groups').first('subject');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: group, subject, participants: [] }])),
    );
    const response = await app.fetch(
      new Request(origin + '/api/v1/trainer/groups/refresh', {
        method: 'POST',
        headers: { Origin: origin, Cookie: '__Host-tt-session=' + 'a'.repeat(64) },
      }),
      env,
      { waitUntil: (p: Promise<unknown>) => tasks.push(p) } as unknown as ExecutionContext,
    );
    await Promise.all(tasks);
    tasks = [];
    expect(response.status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) n FROM groups').first('n')).toBe(0);
    await incoming('Ich komme');
    await db.prepare('DELETE FROM roles').run();
    const count = fetcher.mock.calls.length;
    await sendOutbox(env, now);
    expect(fetcher.mock.calls.length).toBe(count);
    expect((await request()).status).toBe(401);
  });
  it('previews a sentence without persisting or sending anything', async () => {
    expect(
      await (await request('/preview', { text: 'Kann doch', context: 'no' })).json(),
    ).toMatchObject({ kind: 'yes' });
    expect(
      await (await request('/preview', { text: 'Kann doch', context: 'none' })).json(),
    ).toMatchObject({ kind: 'none' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first('n')).toBe(0);
  });
});

it('allows a safe retry after a definite rejection and keeps lateness prompts idempotent', async () => {
  fetcher.mockResolvedValueOnce(new Response('{}', { status: 403 }));
  await request('/create', { confirm: true });
  expect((await state()).group.status).toBe('failed');
  await start();
  await request('/action', { action: 'late', version: 1 });
  const count = fetcher.mock.calls.length;
  await request('/action', { action: 'late', version: 1 });
  expect(fetcher.mock.calls.length).toBe(count);
  expect((await state()).group.delivery).toBe('sent');
});
it('commits an attendance reply together with its state and can recover from a database failure', async () => {
  await start();
  const original = db.batch.bind(db);
  db.batch = async (statements) => {
    db.batch = original;
    return original([...statements, db.prepare('INSERT INTO missing_table VALUES(1)')]);
  };
  const id = 'recoverable-message';
  await expect(incoming('Kann nicht', { id })).rejects.toThrow();
  expect((await state()).participants).toHaveLength(0);
  await incoming('Kann nicht', { id });
  expect((await state()).participants[0].attendance).toBe('no');
  expect(
    await db.prepare("SELECT COUNT(*) n FROM outbox_jobs WHERE kind='practice_reply'").first('n'),
  ).toBe(1);
});
it('prevents database activation as a real training group and erases deleted identities', async () => {
  await start();
  await incoming('Ich komme');
  await expect(
    db
      .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
      .bind(group, 'Übung', now)
      .run(),
  ).rejects.toThrow('practice_group_reserved');
  await db.prepare("DELETE FROM users WHERE id='owner'").run();
  expect(await db.prepare('SELECT COUNT(*) n FROM practice_attendance').first('n')).toBe(0);
  expect(await db.prepare('SELECT group_jid FROM practice_groups').first('group_jid')).toBe(group);
});

it('does not wake production deliveries from a text preview or exercise action', async () => {
  await db
    .prepare(
      "INSERT INTO outbox_jobs(id,dedupe_key,chat_jid,kind,text,due_at,expires_at,created_at) VALUES('live','live',?,'reply','Normale Nachricht',?,?,?)",
    )
    .bind(jid, now, now + 3600000, now)
    .run();
  await request('/preview', { text: 'Kann doch', context: 'no' });
  expect(fetcher).not.toHaveBeenCalled();
  await start();
  expect(await db.prepare("SELECT status FROM outbox_jobs WHERE id='live'").first('status')).toBe(
    'pending',
  );
  expect(
    fetcher.mock.calls
      .filter(([url]) => url.includes('/message/sendText/'))
      .every(([, options]) => JSON.parse(options.body).number === group),
  ).toBe(true);
});

it('provides the owning trainer a shareable group link without sending a message', async () => {
  await start();
  const before = await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first('n');
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        inviteCode: 'TrainerPracticeInviteCode',
        inviteUrl: 'https://untrusted.invalid/ignore',
      }),
    ),
  );
  const response = await request('/invite-link', {});
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    url: 'https://chat.whatsapp.com/TrainerPracticeInviteCode',
  });
  expect(fetcher.mock.calls.at(-1)![0]).toContain('/group/inviteCode/test?groupJid=');
  expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first('n')).toBe(before);
  expect(await db.prepare('SELECT COUNT(*) n FROM roles').first('n')).toBe(1);
});
it('does not expose another trainer’s group invitation or trust invalid provider data', async () => {
  expect((await request('/invite-link', {}, false)).status).toBe(401);
  expect((await request('/invite-link', {})).status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
  await start();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ inviteCode: 'bad/code?secret' })));
  const response = await request('/invite-link', {});
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('bad/code');
  await db.prepare('UPDATE practice_groups SET owner_id=NULL').run();
  const calls = fetcher.mock.calls.length;
  expect((await request('/invite-link', {})).status).toBe(409);
  expect(fetcher.mock.calls.length).toBe(calls);
});

it('answers statistics in practice with isolated live counts and explicitly fictional history', async () => {
  await start();
  await incoming('Ich komme 10 Minuten später');
  const before = await db.prepare('SELECT state FROM practice_attendance').first('state');
  await incoming('Stats', { id: 'practice-stats' });
  await incoming('Stats', { id: 'practice-stats' });
  const jobs = (
    await db
      .prepare("SELECT text FROM outbox_jobs WHERE dedupe_key LIKE '%:practice-stats'")
      .all<{ text: string }>()
  ).results;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].text).toContain('Fiktive Beispielwerte');
  expect(jobs[0].text).toContain('6 Monate');
  expect(jobs[0].text).toContain('/s/');
  expect(jobs[0].text.length).toBeLessThan(300);
  expect(await db.prepare('SELECT state FROM practice_attendance').first('state')).toBe(before);
  expect(await db.prepare('SELECT COUNT(*) n FROM training_sessions').first('n')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) n FROM attendance').first('n')).toBe(0);
  await sendOutbox(env, now);
  expect(
    await db
      .prepare("SELECT status FROM outbox_jobs WHERE dedupe_key LIKE '%:practice-stats'")
      .first('status'),
  ).toBe('sent');
});
it('supports period aliases and reflects reversals without manufacturing historical points', async () => {
  await start();
  await incoming('Kann nicht');
  await incoming('/stats 6 Monate', { id: 'six' });
  const text = await db
    .prepare("SELECT text FROM outbox_jobs WHERE dedupe_key LIKE '%:six'")
    .first<string>('text');
  expect(text).toContain('Fiktive Beispielwerte');
  expect(text).toContain('6 Monate*');
  expect(text).not.toContain('12 Monate');
  await incoming('Kann doch');
  await incoming('Analysen', { id: 'analysis' });
  expect(
    await db
      .prepare("SELECT text FROM outbox_jobs WHERE dedupe_key LIKE '%:analysis'")
      .first('text'),
  ).toContain('Fiktive Beispielwerte');
});
it('does not deliver a queued demo ranking after the round has ended', async () => {
  await start();
  await incoming('Stats', { id: 'pending-stats' });
  await request('/action', { action: 'stop', version: (await state()).group.version });
  await sendOutbox(env, now);
  expect(
    await db
      .prepare("SELECT status FROM outbox_jobs WHERE dedupe_key LIKE '%:pending-stats'")
      .first('status'),
  ).not.toBe('sent');
  const count = await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first('n');
  await incoming('Stats');
  expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first('n')).toBe(count);
});
