import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from './helpers/db';
import {
  dateInZone,
  findTraining,
  materialize,
  movedTimes,
  upcoming,
  type Training,
} from '../apps/worker/src/training';
import { localTimestamp } from '@tt/core';

let db: ReturnType<typeof testDb>;
const group = '120363123456@g.us';
const now = Date.parse('2026-10-08T10:00:00Z');
beforeEach(async () => {
  db = testDb();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', now)
    .run();
  await db
    .prepare(
      "INSERT INTO training_series(id,group_jid,weekday,start_time,end_time,location,created_at) VALUES('weekly',?,4,'18:00','20:00','Sporthalle',?)",
    )
    .bind(group, now)
    .run();
});
afterEach(() => db.close());

describe('training materialization against SQLite', () => {
  it('creates stable weekly dates, is idempotent and resumes without duplicating sessions', async () => {
    await materialize(db, now);
    const first = await upcoming(db, now, group);
    expect(first.length).toBe(7);
    expect(first[0]).toMatchObject({
      id: 'weekly-2026-10-08',
      local_date: '2026-10-08',
      version: 1,
    });
    await materialize(db, now, true);
    expect(await upcoming(db, now, group)).toEqual(first);
    await materialize(db, now + 86400_000, true);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM training_sessions WHERE id='weekly-2026-10-08'")
        .first(),
    ).toEqual({ n: 1 });
  });
  it('honors one-off cancellation and inclusive pause exceptions before generating jobs', async () => {
    await db
      .prepare(
        "INSERT INTO training_exceptions(id,series_id,from_date,to_date,kind,created_at) VALUES('cancel','weekly','2026-10-08','2026-10-08','cancel',?)",
      )
      .bind(now)
      .run();
    await db
      .prepare(
        "INSERT INTO training_exceptions(id,series_id,from_date,to_date,kind,created_at) VALUES('pause','weekly','2026-10-15','2026-10-22','pause',?)",
      )
      .bind(now)
      .run();
    await materialize(db, now, true);
    const dates = (await upcoming(db, now)).map((t) => t.local_date);
    expect(dates).not.toContain('2026-10-08');
    expect(dates).not.toContain('2026-10-15');
    expect(dates).not.toContain('2026-10-22');
    expect(dates[0]).toBe('2026-10-29');
  });
  it('keeps cancelled and moved records stable instead of recreating their initial schedule', async () => {
    await materialize(db, now);
    await db
      .prepare(
        "UPDATE training_sessions SET status='cancelled',version=2 WHERE id='weekly-2026-10-08'",
      )
      .run();
    const movedStart = localTimestamp('2026-10-16', '19:00');
    await db
      .prepare(
        "UPDATE training_sessions SET start_at=?,end_at=?,version=2 WHERE id='weekly-2026-10-15'",
      )
      .bind(movedStart, movedStart + 7200_000)
      .run();
    await materialize(db, now, true);
    expect(
      await db
        .prepare("SELECT status,version FROM training_sessions WHERE id='weekly-2026-10-08'")
        .first(),
    ).toEqual({ status: 'cancelled', version: 2 });
    const [moved] = await findTraining(db, '2026-10-16', now, group);
    expect(moved).toMatchObject({ id: 'weekly-2026-10-15', start_at: movedStart, version: 2 });
  });
  it('selects only the authorized group and future occurrences', async () => {
    await materialize(db, now);
    expect(await upcoming(db, now, '120363999999@g.us')).toEqual([]);
    expect(
      await findTraining(db, '2026-10-08', localTimestamp('2026-10-08', '21:00'), group),
    ).toEqual([]);
    expect((await findTraining(db, 'weekly-2026-10-15', now, group)).length).toBe(1);
  });
  it('rejects a recurring DST gap instead of silently changing the local appointment', async () => {
    await db
      .prepare("UPDATE training_series SET weekday=7,start_time='02:30',end_time='04:00'")
      .run();
    await expect(materialize(db, Date.parse('2026-03-28T10:00:00Z'), true)).rejects.toThrow(
      RangeError,
    );
    expect(await db.prepare('SELECT COUNT(*) AS n FROM training_sessions').first()).toEqual({
      n: 0,
    });
  });
  it('preserves duration and reminder clock when moving across DST, and rejects ambiguous local time', async () => {
    await materialize(db, now);
    const t = (await upcoming(db, now))[0];
    const moved = movedTimes(t, '2026-10-25', '18:00');
    expect(moved.end - moved.start).toBe(7200_000);
    expect(moved.start - moved.invite).toBe(25 * 3600_000);
    expect(moved.start - moved.late).toBe(30 * 60_000);
    expect(dateInZone(moved.start)).toBe('2026-10-25');
    expect(() => movedTimes(t as Training, '2026-10-25', '02:30')).toThrow(RangeError);
  });
});
