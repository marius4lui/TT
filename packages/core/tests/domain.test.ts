import { describe, expect, it } from 'vitest';
import {
  emptyAttendance,
  localTimestamp,
  normalizeEmoji,
  occurrence,
  parseDate,
  parseLateIntent,
  reduceAttendance,
  trainingDates,
} from '../src/index';

describe('local calendar scheduling', () => {
  it('rejects impossible dates, invalid time formats and DST gaps/ambiguities', () => {
    for (const date of ['2026-02-29', '2026-04-31', '2026-2-01', '2026-13-01'])
      expect(() => parseDate(date)).toThrow();
    expect(() => localTimestamp('2026-10-08', '25:00')).toThrow();
    expect(() => localTimestamp('2026-03-29', '02:30')).toThrow();
    expect(() => localTimestamp('2026-10-25', '02:30')).toThrow();
    expect(new Date(localTimestamp('2026-07-01', '18:00')).toISOString()).toBe(
      '2026-07-01T16:00:00.000Z',
    );
  });
  it('keeps the reminder on the previous calendar day across both DST changes', () => {
    const series = { weekday: 7, startTime: '18:00', endTime: '20:00' };
    const spring = occurrence(series, '2026-03-29');
    const autumn = occurrence(series, '2026-10-25');
    expect(spring.startAt - spring.reminderAt).toBe(23 * 3600_000);
    expect(autumn.startAt - autumn.reminderAt).toBe(25 * 3600_000);
    expect(spring.startAt - spring.lateReminderAt).toBe(30 * 60_000);
  });
  it('uses ISO weekdays with inclusive boundaries and validates ranges', () => {
    expect(trainingDates({ weekday: 4 }, '2026-10-08', '2026-10-22')).toEqual([
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
    ]);
    expect(trainingDates({ weekday: 7 }, '2026-03-28', '2026-04-05')).toEqual([
      '2026-03-29',
      '2026-04-05',
    ]);
    expect(() => trainingDates({ weekday: 0 }, '2026-10-08', '2026-10-22')).toThrow();
    expect(() =>
      occurrence({ weekday: 4, startTime: '18:00', endTime: '17:00' }, '2026-10-08'),
    ).toThrow();
  });
});

describe('conservative German late intent', () => {
  it.each([
    ['Ich komme bisschen später heute ins Training', 'late'],
    ['Bin 10 min später da', 'late'],
    ['Verspäte mich', 'late'],
    ['werde später kommen', 'late'],
    ['komm spaeter', 'late'],
    ['Ich komme nicht zu spät', 'punctual'],
    ['Ich komme heute nicht', 'absent'],
    ['Wenn der Bus ausfällt, komme ich später', 'uncertain'],
    ['Vielleicht komme ich später', 'uncertain'],
    ['Ich könnte später kommen', 'uncertain'],
    ['Paul kommt später', 'none'],
    ['Ich glaube Paul kommt später', 'none'],
    ['Die Lieferung kommt zu spät', 'none'],
    ['später', 'uncertain'],
    ['Ich komme nicht pünktlich', 'late'],
    ['Ich verspäte mich nicht', 'punctual'],
    ['Bin pünktlich da', 'punctual'],
    ['Wie viel später kommst du?', 'none'],
    ['Komme ich später?', 'uncertain'],
    ['Ich habe Verspätung', 'late'],
    ['Kann heute nicht kommen', 'absent'],
    ['Ich komme nicht viel später', 'uncertain'],
    ['Ich komme nicht nur später', 'uncertain'],
  ])('%s => %s', (text, expected) => expect(parseLateIntent(text).kind).toBe(expected));
  it('extracts only stated minutes or arrival times', () => {
    expect(parseLateIntent('Bin 10 min später da')).toEqual({ kind: 'late', minutes: 10 });
    expect(parseLateIntent('Ich komme zehn Minuten später')).toEqual({ kind: 'late', minutes: 10 });
    expect(parseLateIntent('Schaffe es erst um 18:20')).toEqual({
      kind: 'late',
      arrivalTime: '18:20',
    });
    expect(parseLateIntent('Ich komme später')).toEqual({ kind: 'late' });
    expect(parseLateIntent('Ich komme 5-10 Minuten später')).toEqual({ kind: 'late' });
  });
});

describe('attendance provenance', () => {
  it('normalizes supported skin-tone and variation-selector emoji', () => {
    expect(normalizeEmoji('👍🏽')).toBe('👍');
    expect(normalizeEmoji('⏰️')).toBe('⏰');
    expect(normalizeEmoji('🤷')).toBe('🤷');
  });
  it('old removed group reaction cannot clear newer private attendance or delay', () => {
    let state = reduceAttendance(emptyAttendance(), {
      id: 'a',
      timestamp: 1,
      source: 'reaction',
      targetId: 'invite',
      attendance: 'yes',
    });
    state = reduceAttendance(state, {
      id: 'b',
      timestamp: 2,
      source: 'private',
      attendance: 'yes',
      late: true,
      minutes: 10,
    });
    expect(
      reduceAttendance(state, {
        id: 'c',
        timestamp: 3,
        source: 'reaction',
        targetId: 'invite',
        remove: true,
      }),
    ).toEqual(state);
    state = reduceAttendance(state, {
      id: 'd',
      timestamp: 4,
      source: 'reaction',
      targetId: 'late',
      late: true,
    });
    state = reduceAttendance(state, {
      id: 'e',
      timestamp: 5,
      source: 'private',
      late: true,
      minutes: 20,
    });
    expect(
      reduceAttendance(state, {
        id: 'f',
        timestamp: 6,
        source: 'reaction',
        targetId: 'late',
        remove: true,
      }),
    ).toEqual(state);
  });
  it('supports current reaction removal, ignores out-of-order replay and clears lateness on absence', () => {
    let state = reduceAttendance(emptyAttendance(), {
      id: 'a',
      timestamp: 1,
      source: 'reaction',
      targetId: 'invite',
      attendance: 'yes',
    });
    state = reduceAttendance(state, {
      id: 'b',
      timestamp: 3,
      source: 'reaction',
      targetId: 'invite',
      remove: true,
    });
    expect(state.attendance).toBe('unknown');
    expect(
      reduceAttendance(state, {
        id: 'c',
        timestamp: 2,
        source: 'reaction',
        targetId: 'invite',
        attendance: 'yes',
      }),
    ).toEqual(state);
    state = reduceAttendance(state, {
      id: 'd',
      timestamp: 4,
      source: 'private',
      attendance: 'yes',
      late: true,
      minutes: 10,
    });
    state = reduceAttendance(state, { id: 'e', timestamp: 5, source: 'private', attendance: 'no' });
    expect(state.attendance).toBe('no');
    expect(state.late).toBe(false);
    expect(state.minutes).toBeUndefined();
  });
});
