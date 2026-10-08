import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from './helpers/db';
import { recordAttendance } from '../apps/worker/src/bot';
import { resolveUser } from '../apps/worker/src/auth';
import { occurrence, type AttendanceChange } from '@tt/core';
import type { BotContext, Env, User } from '../apps/worker/src/types';
import type { Training } from '../apps/worker/src/training';

let db: ReturnType<typeof testDb>,
  env: Env,
  user: User,
  training: Training,
  ctx: BotContext,
  change: AttendanceChange;
const now = Date.parse('2026-10-08T12:00:00Z'),
  group = '120363123456@g.us';
beforeEach(async () => {
  db = testDb();
  env = {
    DB: db,
    ASSETS: {
      fetch: async () => new Response(''),
      connect: () => {
        throw new Error('unused');
      },
    },
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'fixture',
    EVOLUTION_API_KEY: 'fixture',
  };
  user = (await resolveUser(env, '491701234567@s.whatsapp.net', [], 'Mitglied', now))!;
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'Training', now)
    .run();
  await db
    .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
    .bind(group, user.id, now)
    .run();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  const times = occurrence({ weekday: 4, startTime: '18:00', endTime: '20:00' }, '2026-10-08');
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-08',?,?,'Europe/Berlin','Halle',?,?,?)",
    )
    .bind(group, times.startAt, times.endAt, times.reminderAt, times.lateReminderAt, now)
    .run();
  training = (await db
    .prepare("SELECT * FROM training_sessions WHERE id='training'")
    .first<Training>())!;
  ctx = {
    env,
    user,
    chatJid: group,
    isGroup: true,
    text: '',
    eventId: 'attendance-event',
    timestamp: now + 1000,
    now: now + 1000,
    origin: 'https://tt.bz3.eu',
  };
  change = {
    id: ctx.eventId,
    timestamp: ctx.timestamp,
    source: 'reaction',
    targetId: 'invite',
    attendance: 'yes',
  };
});
afterEach(() => db.close());
async function acknowledgements(): Promise<number> {
  return (await db
    .prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE dedupe_key LIKE 'attendance:%'")
    .first<number>('n'))!;
}
describe('atomic attendance acknowledgements', () => {
  it('rolls back the attendance change if persisting the acknowledgement fails, then retries successfully', async () => {
    const original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      return original([...statements, db.prepare('INSERT INTO missing_table(value) VALUES(1)')]);
    }) as typeof db.batch;
    await expect(recordAttendance(ctx, training, change)).rejects.toThrow();
    expect(await db.prepare('SELECT response,response_source FROM attendance').first()).toEqual({
      response: 'unknown',
      response_source: null,
    });
    expect(await acknowledgements()).toBe(0);
    expect(await recordAttendance(ctx, training, change)).toBe('updated');
    expect(await acknowledgements()).toBe(1);
  });
  it('keeps one acknowledgement after a crash immediately following commit and an unchanged replay', async () => {
    const original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      await original(statements);
      throw new Error('postcommit_crash');
    }) as typeof db.batch;
    await expect(recordAttendance(ctx, training, change)).rejects.toThrow('postcommit');
    expect(await acknowledgements()).toBe(1);
    expect(await recordAttendance(ctx, training, change)).toBe('unchanged');
    expect(await acknowledgements()).toBe(1);
    expect(await db.prepare('SELECT response FROM attendance').first('response')).toBe('yes');
  });
  it('does not acknowledge a lost optimistic race or overwrite the winning event', async () => {
    const original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      const stamp = JSON.stringify({
        id: 'newer-winner',
        timestamp: ctx.timestamp + 1000,
        source: 'private',
      });
      await db
        .prepare("UPDATE attendance SET response='no',response_source=?,response_at=?,updated_at=?")
        .bind(stamp, ctx.timestamp + 1000, ctx.now)
        .run();
      return original(statements);
    }) as typeof db.batch;
    expect(await recordAttendance(ctx, training, change)).toBe('unchanged');
    expect(await db.prepare('SELECT response FROM attendance').first('response')).toBe('no');
    expect(await acknowledgements()).toBe(0);
  });
  it('ignores old events without clearing the need for reconfirmation after a moved training', async () => {
    await recordAttendance(ctx, training, change);
    await db.prepare('UPDATE attendance SET needs_confirmation=1').run();
    const old = { ...ctx, eventId: 'old-event', timestamp: ctx.timestamp - 1000 };
    expect(
      await recordAttendance(old, training, {
        ...change,
        id: old.eventId,
        timestamp: old.timestamp,
        attendance: 'no',
      }),
    ).toBe('unchanged');
    expect(await db.prepare('SELECT response,needs_confirmation FROM attendance').first()).toEqual({
      response: 'yes',
      needs_confirmation: 1,
    });
    expect(await acknowledgements()).toBe(1);
  });
  it('routes a group acknowledgement using consent at commit time instead of a stale user snapshot', async () => {
    await db
      .prepare('UPDATE users SET registered_at=?,reminders=1 WHERE id=?')
      .bind(now, user.id)
      .run();
    await db
      .prepare(
        "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('yes',?,'reminders','1',1,'consent',?)",
      )
      .bind(user.id, now)
      .run();
    ctx.user = { ...user, registered_at: now, reminders: 1 };
    const original = db.batch.bind(db);
    db.batch = (async (statements) => {
      db.batch = original;
      await db.prepare('UPDATE users SET reminders=0 WHERE id=?').bind(user.id).run();
      return original(statements);
    }) as typeof db.batch;
    expect(await recordAttendance(ctx, training, change)).toBe('updated');
    expect(
      await db
        .prepare(
          "SELECT chat_jid,user_id FROM outbox_jobs WHERE dedupe_key='attendance:attendance-event'",
        )
        .first(),
    ).toEqual({ chat_jid: group, user_id: null });
  });
  it('records a web update without generating a WhatsApp acknowledgement', async () => {
    expect(await recordAttendance(ctx, training, change, undefined, false)).toBe('updated');
    expect(await acknowledgements()).toBe(0);
  });
});
