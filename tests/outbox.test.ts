import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { planJobs, queue, sendOutbox, type QueueInput } from '../apps/worker/src/outbox';
import { processMessage } from '../apps/worker/src/bot';
import { occurrence } from '@tt/core';
import { EvolutionClient, TransportError } from '@tt/whatsapp';
import type { Env } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env;
const group = '120363123456@g.us',
  jid = '491701234567@s.whatsapp.net';
const times = occurrence({ weekday: 4, startTime: '18:00', endTime: '20:00' }, '2026-10-08');
const now = times.startAt - 60 * 60_000;
beforeEach(async () => {
  db = testDb();
  env = {
    DB: db,
    ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } as unknown as Fetcher,
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'tt-test',
    EVOLUTION_API_KEY: 'test-only-secret',
  };
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', now)
    .run();
  await db
    .prepare('INSERT INTO users(id,jid,registered_at,reminders,created_at) VALUES(?,?,?,1,?)')
    .bind('member', jid, now - 86400_000, now)
    .run();
  await db
    .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
    .bind(group, 'member', now)
    .run();
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-08',?,?,'Europe/Berlin','Sporthalle',?,?,?)",
    )
    .bind(group, times.startAt, times.endAt, times.reminderAt, times.lateReminderAt, now)
    .run();
  await db
    .prepare(
      "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('consent','member','reminders','1',1,'consent-event',?)",
    )
    .bind(times.reminderAt - 1)
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
function sender() {
  const sendText = vi.fn().mockImplementation(async () => ({ id: crypto.randomUUID() }));
  const sendContact = vi.fn().mockResolvedValue({ id: 'card-id' });
  const sendReaction = vi.fn().mockImplementation(async () => ({ id: crypto.randomUUID() }));
  return {
    client: { sendText, sendContact, sendReaction } as unknown as EvolutionClient,
    sendText,
    sendContact,
    sendReaction,
  };
}
async function job(overrides: Partial<QueueInput> = {}) {
  await queue(
    db,
    {
      key: crypto.randomUUID(),
      chat: group,
      text: 'Training',
      kind: 'invite',
      sessionId: 'training',
      version: 1,
      expires: times.startAt,
      ...overrides,
    },
    now,
  );
}

describe('durable planning and delivery guards', () => {
  it('combines overdue invitation and late prompt without links or a second text', async () => {
    const at = times.startAt - 60_000;
    await planJobs(db, at);
    const mock = sender();
    await sendOutbox(env, at, mock.client);
    // One group invitation and one explicitly subscribed personal invitation.
    expect(mock.sendText).toHaveBeenCalledTimes(2);
    for (const [, text] of mock.sendText.mock.calls) {
      expect(text).toContain('👍 Ich komme');
      expect(text).toContain('👎 Ich komme nicht');
      expect(text).toContain('⏰ Ich komme später');
      expect(text).not.toMatch(/https?:|Powered|training\)/);
    }
    expect(mock.sendReaction).toHaveBeenCalledTimes(2);
    await planJobs(db, at + 60_000);
    await sendOutbox(env, at + 60_000, mock.client);
    expect(mock.sendText).toHaveBeenCalledTimes(2);
    expect(mock.sendReaction).toHaveBeenCalledTimes(2);
  });
  it('keeps a clock retry independent from the text and valid after training starts', async () => {
    const at = times.startAt - 1000;
    await job({ kind: 'invite' });
    const mock = sender();
    mock.sendReaction.mockRejectedValueOnce(new TransportError('retryable', 429, 20_000));
    await sendOutbox(env, at, mock.client);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
    const clock = await db
      .prepare("SELECT expires_at,status FROM outbox_jobs WHERE kind='clock'")
      .first();
    expect(clock).toEqual({ expires_at: times.endAt, status: 'pending' });
    await sendOutbox(env, at + 30_000, mock.client);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
    expect(mock.sendReaction).toHaveBeenCalledTimes(2);
    expect(await db.prepare("SELECT status FROM outbox_jobs WHERE kind='clock'").first()).toEqual({
      status: 'sent',
    });
  });
  it('backfills only the clock on an already sent current late prompt', async () => {
    await job({ kind: 'late', key: 'old-late', expires: times.endAt });
    await db
      .prepare(
        "UPDATE outbox_jobs SET status='sent',provider_id='old-prompt' WHERE dedupe_key='old-late'",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO messages(id,chat_jid,session_id,session_version,kind,created_at) VALUES('old-prompt',?,'training',1,'late',?)",
      )
      .bind(group, now)
      .run();
    await planJobs(db, times.startAt + 10 * 60_000);
    const mock = sender();
    await sendOutbox(env, times.startAt + 10 * 60_000, mock.client);
    expect(mock.sendText).not.toHaveBeenCalled();
    expect(mock.sendReaction).toHaveBeenCalledWith(group, 'old-prompt', '⏰');
    await planJobs(db, times.startAt + 11 * 60_000);
    await sendOutbox(env, times.startAt + 11 * 60_000, mock.client);
    expect(mock.sendReaction).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1])(
    'uses only current absence to suppress a private late notice (stale=%s)',
    async (stale) => {
      await db
        .prepare(
          "INSERT INTO attendance(session_id,user_id,response,needs_confirmation,updated_at) VALUES('training','member','no',?,?)",
        )
        .bind(stale, now)
        .run();
      await job({ kind: 'personal_late', userId: 'member', chat: jid, expires: times.endAt });
      const mock = sender();
      await sendOutbox(env, times.lateReminderAt, mock.client);
      expect(mock.sendText).toHaveBeenCalledTimes(stale);
    },
  );
  it('renders delayed late reminders using the actual remaining time at delivery', async () => {
    await job({
      kind: 'late',
      text: 'old nominal reminder',
      due: times.lateReminderAt,
      expires: times.endAt,
    });
    const mock = sender();
    expect(await sendOutbox(env, times.startAt - 7 * 60_000, mock.client)).toBe(2);
    expect(mock.sendText.mock.calls[0][1]).toContain('7 Minuten');
    expect(mock.sendText.mock.calls[0][1]).not.toContain('30 Minuten');
  });
  it('deduplicates logical jobs and records one successful provider message', async () => {
    await job({ key: 'stable-key' });
    await job({ key: 'stable-key' });
    const mock = sender();
    expect(await sendOutbox(env, now, mock.client)).toBe(1);
    expect(await sendOutbox(env, now, mock.client)).toBe(0);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
    expect(await db.prepare('SELECT status,attempts FROM outbox_jobs').first()).toEqual({
      status: 'sent',
      attempts: 1,
    });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM messages').first()).toEqual({ n: 1 });
  });
  it('uses the atomic lease to prevent two concurrent cron senders from sending the same job', async () => {
    await job();
    const mock = sender();
    const results = await Promise.all([
      sendOutbox(env, now, mock.client),
      sendOutbox(env, now, mock.client),
    ]);
    expect(results.reduce((sum, result) => sum + result, 0)).toBe(1);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
    expect(await db.prepare('SELECT status,attempts FROM outbox_jobs').first()).toEqual({
      status: 'sent',
      attempts: 1,
    });
  });
  it('plans only members who registered and opted in before the scheduled message', async () => {
    await planJobs(db, now);
    await planJobs(db, now);
    expect(
      (await db.prepare('SELECT kind FROM outbox_jobs ORDER BY kind').all()).results.map(
        (r) => (r as { kind: string }).kind,
      ),
    ).toEqual(['invite', 'late', 'personal_invite', 'personal_late']);
    await db.prepare('DELETE FROM outbox_jobs').run();
    await db.prepare("UPDATE consents SET created_at=? WHERE purpose='reminders'").bind(now).run();
    await planJobs(db, now);
    expect(
      (await db.prepare("SELECT kind FROM outbox_jobs WHERE user_id='member'").all()).results,
    ).toEqual([{ kind: 'personal_late' }]);
    await db.prepare('DELETE FROM outbox_jobs').run();
    await db.prepare("UPDATE users SET reminders=0 WHERE id='member'").run();
    await planJobs(db, now);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind LIKE 'personal_%'")
        .first(),
    ).toEqual({ n: 0 });
  });
  it('requires recorded accepted consent and treats the latest withdrawal as authoritative', async () => {
    await db.prepare('DELETE FROM consents').run();
    await planJobs(db, now);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind LIKE 'personal_%'")
        .first(),
    ).toEqual({ n: 0 });
    await db.prepare('DELETE FROM outbox_jobs').run();
    await db
      .prepare(
        "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('old-consent','member','reminders','1',1,'old-consent-event',?)",
      )
      .bind(times.reminderAt - 1)
      .run();
    await db
      .prepare(
        "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('withdrawal','member','reminders','1',0,'withdrawal-event',?)",
      )
      .bind(now - 1)
      .run();
    await planJobs(db, now);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind LIKE 'personal_%'")
        .first(),
    ).toEqual({ n: 0 });
  });
  it.each([
    'consent',
    'consent_record',
    'membership',
    'registration',
    'group',
    'version',
    'privacy',
    'disabled',
    'cancelled',
  ])('rechecks %s before provider delivery', async (reason) => {
    await job({ chat: jid, kind: 'personal_invite', userId: 'member' });
    if (reason === 'consent')
      await db.prepare("UPDATE users SET reminders=0 WHERE id='member'").run();
    if (reason === 'consent_record')
      await db
        .prepare(
          "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('latest-withdrawal','member','reminders','1',0,'latest-withdrawal-event',?)",
        )
        .bind(now - 1)
        .run();
    if (reason === 'membership') await db.prepare('UPDATE memberships SET active=0').run();
    if (reason === 'registration') await db.prepare('UPDATE users SET registered_at=NULL').run();
    if (reason === 'group') await db.prepare('UPDATE groups SET active=0').run();
    if (reason === 'version') await db.prepare('UPDATE training_sessions SET version=2').run();
    if (reason === 'privacy')
      await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    if (reason === 'disabled')
      await db.prepare("UPDATE settings SET value='0' WHERE key='enabled'").run();
    if (reason === 'cancelled')
      await db.prepare("UPDATE training_sessions SET status='cancelled'").run();
    const mock = sender();
    expect(await sendOutbox(env, now, mock.client)).toBe(0);
    expect(mock.sendText).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT status FROM outbox_jobs').first()).toEqual({
      status: 'cancelled',
    });
  });
  it('delivers current cancellation notices to group and consenting members', async () => {
    await db.prepare("UPDATE training_sessions SET status='cancelled',version=2").run();
    await job({ kind: 'change', version: 2 });
    await job({ kind: 'personal_change', chat: jid, userId: 'member', version: 2 });
    const mock = sender();
    expect(await sendOutbox(env, now, mock.client)).toBe(2);
    expect(mock.sendText).toHaveBeenCalledTimes(2);
  });
  it('expires stale reminders and does not restart leases that may already have sent', async () => {
    await job({ expires: now });
    await job({ key: 'interrupted' });
    await db
      .prepare(
        "UPDATE outbox_jobs SET status='processing',lease_until=? WHERE dedupe_key='interrupted'",
      )
      .bind(now - 1)
      .run();
    const mock = sender();
    expect(await sendOutbox(env, now, mock.client)).toBe(0);
    expect(mock.sendText).not.toHaveBeenCalled();
    expect(
      (await db.prepare('SELECT status FROM outbox_jobs ORDER BY status').all()).results,
    ).toEqual([{ status: 'expired' }, { status: 'uncertain' }]);
  });
  it('sends a contact card through the contact transport', async () => {
    await queue(
      db,
      {
        key: 'card',
        chat: jid,
        kind: 'contact',
        text: JSON.stringify({ name: 'TT', phone: '491709999999' }),
      },
      now,
    );
    const mock = sender();
    expect(await sendOutbox(env, now, mock.client)).toBe(1);
    expect(mock.sendContact).toHaveBeenCalledWith(jid, 'TT', '491709999999');
    expect(mock.sendText).not.toHaveBeenCalled();
  });
});

describe('outbox failure classification', () => {
  it('does not resurrect a personal job cancelled by /stop while an in-flight send returns 429', async () => {
    await job({ key: 'inflight-personal', kind: 'personal_invite', chat: jid, userId: 'member' });
    const mock = sender();
    mock.sendText.mockImplementation(async () => {
      await processMessage(
        env,
        {
          id: 'stop-during-send',
          senderJid: jid,
          chatJid: jid,
          aliases: [jid],
          displayName: 'Mitglied',
          timestamp: now + 1,
          isGroup: false,
          text: '/stop',
        },
        now + 1,
      );
      throw new TransportError('retryable', 429, 120000);
    });
    expect(await sendOutbox(env, now, mock.client)).toBe(0);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
    expect(
      await db
        .prepare("SELECT status,attempts FROM outbox_jobs WHERE dedupe_key='inflight-personal'")
        .first(),
    ).toEqual({ status: 'cancelled', attempts: 1 });
    expect(await db.prepare("SELECT reminders FROM users WHERE id='member'").first()).toEqual({
      reminders: 0,
    });
  });
  it('reschedules definite 429 failures with provider backoff and pauses the current batch', async () => {
    await job({ key: 'one' });
    await job({ key: 'two' });
    const mock = sender();
    mock.sendText.mockRejectedValue(new TransportError('retryable', 429, 120_000));
    expect(await sendOutbox(env, now, mock.client)).toBe(0);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
    expect(
      await db
        .prepare("SELECT status,due_at,attempts,error FROM outbox_jobs WHERE dedupe_key='one'")
        .first(),
    ).toEqual({ status: 'pending', due_at: now + 120_000, attempts: 1, error: 'retryable:429' });
    mock.sendText.mockImplementation(async () => ({ id: crypto.randomUUID() }));
    expect(await sendOutbox(env, now + 120_000, mock.client)).toBe(2);
  });
  it.each([
    [new TransportError('ambiguous', 503), 'uncertain', 'ambiguous:503'],
    [new TransportError('permanent', 400), 'failed', 'permanent:400'],
    [new Error('secret raw provider details'), 'uncertain', 'unknown_send_outcome'],
  ])(
    'keeps ambiguous and permanent outcomes away from automatic retry',
    async (error, status, code) => {
      await job();
      const mock = sender();
      mock.sendText.mockRejectedValue(error);
      expect(await sendOutbox(env, now, mock.client)).toBe(0);
      expect(await sendOutbox(env, now + 60_000, mock.client)).toBe(0);
      expect(mock.sendText).toHaveBeenCalledTimes(1);
      expect(await db.prepare('SELECT status,error FROM outbox_jobs').first()).toEqual({
        status,
        error: code,
      });
    },
  );
  it('stops definite retries after the fifth attempt', async () => {
    await job();
    await db.prepare('UPDATE outbox_jobs SET attempts=4').run();
    const mock = sender();
    mock.sendText.mockRejectedValue(new TransportError('retryable', 429));
    await sendOutbox(env, now, mock.client);
    expect(await db.prepare('SELECT status,attempts FROM outbox_jobs').first()).toEqual({
      status: 'failed',
      attempts: 5,
    });
  });
});
