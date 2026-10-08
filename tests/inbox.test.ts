import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { acceptWebhook, cleanup, drainInbox } from '../apps/worker/src/inbox';
import { resolveUser } from '../apps/worker/src/auth';
import { hashToken } from '../apps/worker/src/security';
import { queue } from '../apps/worker/src/outbox';
import { occurrence } from '@tt/core';
import type { Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, now: number, member: User;
const group = '120363123456@g.us';
beforeEach(async () => {
  db = testDb();
  now = Date.parse('2026-10-08T12:00:00Z');
  env = {
    DB: db,
    ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } as unknown as Fetcher,
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'tt-test',
    EVOLUTION_API_KEY: 'test-secret',
  };
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', now)
    .run();
  member = (await resolveUser(
    env,
    '491701234568@s.whatsapp.net',
    ['123456789123@lid'],
    'Mitglied',
    now,
  ))!;
  await db
    .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
    .bind(group, member.id, now)
    .run();
  const t = occurrence({ weekday: 4, startTime: '18:00', endTime: '20:00' }, '2026-10-08');
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-08',?,?,'Europe/Berlin','Sporthalle',?,?,?)",
    )
    .bind(group, t.startAt, t.endAt, t.reminderAt, t.lateReminderAt, now)
    .run();
  await db
    .prepare(
      "INSERT INTO messages(id,chat_jid,session_id,session_version,kind,created_at) VALUES('invitation',?,'training',1,'invite',?)",
    )
    .bind(group, now)
    .run();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('No real provider calls in inbox tests');
    }),
  );
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function payload(text = '/hilfe', id: string = crypto.randomUUID(), isGroup = false) {
  return {
    event: 'messages.upsert',
    instance: 'tt-test',
    apikey: 'envelope-provider-secret',
    data: {
      key: {
        id,
        remoteJid: isGroup ? group : member.jid,
        participant: isGroup ? member.jid : undefined,
        fromMe: false,
      },
      pushName: 'Mitglied',
      messageTimestamp: now / 1000,
      message: { conversation: text },
    },
  };
}
function control(action: string, date = now, chat = group) {
  return {
    event: 'group-participants.update',
    instance: 'tt-test',
    date_time: new Date(date).toISOString(),
    data: { id: chat, action, participants: ['123456789123@lid'] },
  };
}

describe('durable inbox normalization and replay protection', () => {
  it('scopes dedupe by instance/chat/provider ID and retains no envelope API secrets', async () => {
    const event = payload('/hilfe', 'provider-id');
    expect(await acceptWebhook(env, event, now)).toBe(1);
    expect(await acceptWebhook(env, event, now)).toBe(0);
    const stored = await db
      .prepare('SELECT id,payload,status FROM inbox_events')
      .first<{ id: string; payload: string; status: string }>();
    expect(stored?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.status).toBe('pending');
    expect(stored?.payload).not.toContain('envelope-provider-secret');
    expect(await acceptWebhook(env, payload('/hilfe', 'provider-id', true), now)).toBe(1);
    expect(await drainInbox(env, now)).toBe(2);
    expect(await drainInbox(env, now)).toBe(0);
    expect((await db.prepare('SELECT status,payload FROM inbox_events').all()).results).toEqual([
      { status: 'done', payload: '' },
      { status: 'done', payload: '' },
    ]);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first()).toEqual({ n: 2 });
  });
  it('drops foreign instances, inactive groups, self messages and explicitly marked history', async () => {
    const event = payload('/hilfe', 'id', true);
    expect(await acceptWebhook(env, { ...event, instance: 'foreign' }, now)).toBe(0);
    expect(
      await acceptWebhook(env, { ...event, data: { ...event.data, type: 'append' } }, now),
    ).toBe(0);
    expect(
      await acceptWebhook(
        env,
        { ...event, data: { ...event.data, key: { ...event.data.key, fromMe: true } } },
        now,
      ),
    ).toBe(0);
    await db.prepare('UPDATE groups SET active=0').run();
    expect(await acceptWebhook(env, event, now)).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM inbox_events').first()).toEqual({ n: 0 });
  });
  it.each(['privacy_ready', 'enabled'])(
    'does not persist group text when %s is revoked',
    async (setting) => {
      await db.prepare('UPDATE settings SET value=? WHERE key=?').bind('0', setting).run();
      expect(await acceptWebhook(env, payload('/hilfe', 'group-event', true), now)).toBe(0);
      expect(await db.prepare('SELECT COUNT(*) AS n FROM inbox_events').first()).toEqual({ n: 0 });
      expect(await acceptWebhook(env, payload('/hilfe', 'private-event'), now)).toBe(1);
    },
  );
  it('atomically leases inbox work so concurrent drains process an attendance reaction once', async () => {
    const event = payload('', 'reaction-event', true);
    event.data.message = {
      reactionMessage: { key: { id: 'invitation', remoteJid: group, fromMe: true }, text: '👍' },
    } as unknown as typeof event.data.message;
    await acceptWebhook(env, event, now);
    const result = await Promise.all([drainInbox(env, now), drainInbox(env, now)]);
    expect(result.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await db.prepare('SELECT response FROM attendance').first()).toEqual({
      response: 'yes',
    });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first()).toEqual({ n: 1 });
  });
  it('redacts bootstrap codes in persisted events while preserving the actual setup claim through a digest', async () => {
    const code = '1234567890abcdef1234567890abcdef';
    await db
      .prepare("INSERT INTO bootstrap(id,state,code_hash,expires_at) VALUES(1,'pending',?,?)")
      .bind(await hashToken(code), now + 60000)
      .run();
    await acceptWebhook(env, payload(`/einrichten ${code}`, 'setup-event'), now);
    const stored = (await db
      .prepare('SELECT payload FROM inbox_events')
      .first<{ payload: string }>())!.payload;
    expect(stored).not.toContain(code);
    expect(JSON.parse(stored).event).toMatchObject({
      text: '/einrichten [geschützt]',
      credentialHash: await hashToken(code),
    });
    expect(await drainInbox(env, now)).toBe(1);
    expect(await db.prepare('SELECT state,reserved_user_id FROM bootstrap').first()).toEqual({
      state: 'reserved',
      reserved_user_id: member.id,
    });
    now += 1000;
    await acceptWebhook(env, payload('JA', 'setup-confirm-event'), now);
    await drainInbox(env, now);
    expect(await db.prepare('SELECT state FROM bootstrap').first()).toEqual({ state: 'completed' });
    expect(
      await db.prepare('SELECT role FROM roles WHERE user_id=?').bind(member.id).first(),
    ).toEqual({ role: 'owner' });
  });
  it('expires day-old pending events and retries crashed leases without retaining processed text', async () => {
    await acceptWebhook(env, payload('/hilfe', 'old-event'), now);
    await db
      .prepare('UPDATE inbox_events SET created_at=?')
      .bind(now - 86400_001)
      .run();
    expect(await drainInbox(env, now)).toBe(0);
    expect(await db.prepare('SELECT status,payload FROM inbox_events').first()).toEqual({
      status: 'expired',
      payload: '',
    });
    await acceptWebhook(env, payload('/hilfe', 'crashed-event'), now);
    await db
      .prepare("UPDATE inbox_events SET status='processing',lease_until=? WHERE status='pending'")
      .bind(now - 1)
      .run();
    expect(await drainInbox(env, now)).toBe(1);
    expect(
      await db.prepare("SELECT status,payload FROM inbox_events WHERE status='done'").first(),
    ).toEqual({ status: 'done', payload: '' });
  });
  it('bounds malformed-event retries and exposes only a sanitized processing error', async () => {
    await db
      .prepare('INSERT INTO inbox_events(id,payload,created_at) VALUES(?,?,?)')
      .bind('bad', 'secret malformed JSON', now)
      .run();
    for (let attempt = 0; attempt < 6; attempt++) expect(await drainInbox(env, now)).toBe(0);
    expect(await db.prepare('SELECT status,attempts,error FROM inbox_events').first()).toEqual({
      status: 'failed',
      attempts: 5,
      error: 'processing_failed',
    });
  });
});

describe('membership controls and retention', () => {
  it('resolves removals through stored LID aliases, stops personal jobs and prevents old add events reviving membership', async () => {
    await queue(
      db,
      {
        key: 'personal',
        chat: member.jid,
        userId: member.id,
        sessionId: 'training',
        version: 1,
        kind: 'personal_late',
        text: 'reminder',
      },
      now,
    );
    await acceptWebhook(env, control('remove', now + 1000), now + 1000);
    await drainInbox(env, now + 1000);
    expect(
      await db
        .prepare('SELECT active,updated_at FROM memberships WHERE user_id=?')
        .bind(member.id)
        .first(),
    ).toEqual({ active: 0, updated_at: now + 1000 });
    expect(
      await db.prepare("SELECT status FROM outbox_jobs WHERE dedupe_key='personal'").first(),
    ).toEqual({ status: 'cancelled' });
    await acceptWebhook(env, control('add', now - 1000), now + 2000);
    await drainInbox(env, now + 2000);
    expect(
      await db.prepare('SELECT active FROM memberships WHERE user_id=?').bind(member.id).first(),
    ).toEqual({ active: 0 });
  });
  it('stores connection state but never derives a phone alias from enhanced participantsData fallback digits', async () => {
    await acceptWebhook(
      env,
      { instance: 'tt-test', event: 'connection.update', data: { state: 'close' } },
      now,
    );
    await drainInbox(env, now);
    expect(
      await db.prepare("SELECT value FROM settings WHERE key='connection_state'").first(),
    ).toEqual({ value: 'close' });
    const unknown = {
      ...control('remove'),
      data: {
        ...control('remove').data,
        participants: ['999999999999@lid'],
        participantsData: [{ jid: '999999999999@lid', phoneNumber: member.jid.split('@')[0] }],
      },
    };
    await acceptWebhook(env, unknown, now);
    await drainInbox(env, now);
    expect(
      await db.prepare('SELECT active FROM memberships WHERE user_id=?').bind(member.id).first(),
    ).toEqual({ active: 1 });
    expect(
      await db.prepare("SELECT user_id FROM identity_aliases WHERE jid='999999999999@lid'").first(),
    ).toBeNull();
  });
  it('does not cancel newer active membership jobs when an older removal control arrives late', async () => {
    await queue(
      db,
      {
        key: 'current-personal',
        chat: member.jid,
        userId: member.id,
        sessionId: 'training',
        version: 1,
        kind: 'personal_late',
        text: 'reminder',
      },
      now,
    );
    await acceptWebhook(env, control('remove', now - 1000), now);
    await drainInbox(env, now);
    expect(
      await db.prepare('SELECT active FROM memberships WHERE user_id=?').bind(member.id).first(),
    ).toEqual({ active: 1 });
    expect(
      await db
        .prepare("SELECT status FROM outbox_jobs WHERE dedupe_key='current-personal'")
        .first(),
    ).toEqual({ status: 'pending' });
  });
  it('clears retained text after expiry, keeps recent dedupe IDs and removes older IDs', async () => {
    const day = 86400_000;
    await db
      .prepare(
        "INSERT INTO inbox_events(id,payload,status,created_at) VALUES('one-day','private text','pending',?)",
      )
      .bind(now - day - 1)
      .run();
    await db
      .prepare(
        "INSERT INTO inbox_events(id,payload,status,created_at) VALUES('old','old text','done',?)",
      )
      .bind(now - 31 * day)
      .run();
    await queue(
      db,
      { key: 'old-send', chat: member.jid, text: 'retained private text' },
      now - 8 * day,
    );
    await db.prepare("UPDATE outbox_jobs SET status='sent' WHERE dedupe_key='old-send'").run();
    await cleanup(db, now);
    expect(
      await db.prepare("SELECT status,payload FROM inbox_events WHERE id='one-day'").first(),
    ).toEqual({ status: 'expired', payload: '' });
    expect(await db.prepare("SELECT id FROM inbox_events WHERE id='old'").first()).toBeNull();
    expect(
      await db.prepare("SELECT text FROM outbox_jobs WHERE dedupe_key='old-send'").first(),
    ).toEqual({ text: '' });
  });
});
