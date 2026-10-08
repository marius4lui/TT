import { occurrence, trainingDates, localTimestamp, parseDate } from '@tt/core';
import { all, setting } from './db';

export interface Series {
  id: string;
  group_jid: string;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
  location: string;
  reminder_time: string;
  late_offset: number;
  active: number;
  created_at: number;
}
export interface Training {
  id: string;
  series_id: string | null;
  group_jid: string;
  local_date: string;
  start_at: number;
  end_at: number;
  timezone: string;
  location: string;
  invite_at: number;
  late_at: number;
  status: 'scheduled' | 'cancelled';
  version: number;
  created_at: number;
}
export const shortId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
export function dateInZone(ms: number, zone = 'Europe/Berlin'): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}
export function label(t: Training): string {
  const date = new Intl.DateTimeFormat('de-DE', {
    timeZone: t.timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(t.start_at);
  const time = (n: number) =>
    new Intl.DateTimeFormat('de-DE', {
      timeZone: t.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(n);
  return `${date}, ${time(t.start_at)}–${time(t.end_at)} Uhr · ${t.location}`;
}
export async function materialize(db: D1Database, now: number, force = false): Promise<void> {
  const today = dateInZone(now);
  if (!force && (await setting(db, 'materialized_date')) === today) return;
  const through = parseDate(today).add({ days: 42 }).toString();
  const series = await all<Series>(db, 'SELECT * FROM training_series WHERE active=1');
  for (const row of series) {
    const spec = {
      weekday: row.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone,
      reminderTime: row.reminder_time,
      lateReminderMinutes: row.late_offset,
    };
    for (const date of trainingDates(spec, today, through)) {
      const excluded = await db
        .prepare(
          'SELECT id FROM training_exceptions WHERE series_id=? AND from_date<=? AND to_date>=?',
        )
        .bind(row.id, date, date)
        .first();
      if (excluded) continue;
      const o = occurrence(spec, date);
      if (o.endAt <= now) continue;
      await db
        .prepare(
          `INSERT OR IGNORE INTO training_sessions(id,series_id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM training_series WHERE id=? AND active=1) AND NOT EXISTS(SELECT 1 FROM training_exceptions WHERE series_id=? AND from_date<=? AND to_date>=?)`,
        )
        .bind(
          `${row.id}-${date}`,
          row.id,
          row.group_jid,
          date,
          o.startAt,
          o.endAt,
          row.timezone,
          row.location,
          o.reminderAt,
          o.lateReminderAt,
          now,
          row.id,
          row.id,
          date,
          date,
        )
        .run();
    }
  }
  await db
    .prepare(
      "INSERT INTO settings(key,value) VALUES('materialized_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .bind(today)
    .run();
}
export async function upcoming(db: D1Database, now: number, group?: string): Promise<Training[]> {
  return group
    ? all<Training>(
        db,
        'SELECT * FROM training_sessions WHERE end_at>? AND group_jid=? ORDER BY start_at LIMIT 30',
        now,
        group,
      )
    : all<Training>(
        db,
        'SELECT * FROM training_sessions WHERE end_at>? ORDER BY start_at LIMIT 30',
        now,
      );
}
export async function findTraining(
  db: D1Database,
  reference: string,
  now: number,
  group?: string,
): Promise<Training[]> {
  const rows = await upcoming(db, now, group);
  return rows.filter(
    (t) =>
      t.id === reference ||
      t.local_date === reference ||
      dateInZone(t.start_at, t.timezone) === reference,
  );
}
export function movedTimes(
  t: Training,
  date: string,
  time: string,
): { start: number; end: number; invite: number; late: number } {
  const start = localTimestamp(date, time, t.timezone);
  const dayBefore = parseDate(date).subtract({ days: 1 }).toString();
  const reminderTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: t.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(t.invite_at);
  return {
    start,
    end: start + (t.end_at - t.start_at),
    invite: localTimestamp(dayBefore, reminderTime, t.timezone),
    late: start - (t.start_at - t.late_at),
  };
}
