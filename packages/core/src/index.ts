import { Temporal } from '@js-temporal/polyfill';
export { attendanceIntent, chatIntent, normalizeLanguage, type AttendanceIntent } from './language';

export const DEFAULT_TIMEZONE = 'Europe/Berlin';

/** Strict calendar input: Temporal's default overflow constraining is deliberately disabled. */
export function parseDate(value: string): Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Datum muss YYYY-MM-DD sein.');
  return Temporal.PlainDate.from(value, { overflow: 'reject' });
}

export function localTimestamp(date: string, time: string, timezone = DEFAULT_TIMEZONE): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError('Uhrzeit muss HH:mm sein.');
  const day = parseDate(date);
  const clock = Temporal.PlainTime.from(time, { overflow: 'reject' });
  return day.toPlainDateTime(clock).toZonedDateTime(timezone, { disambiguation: 'reject' })
    .epochMilliseconds;
}

export interface TrainingSeries {
  weekday: number;
  startTime: string;
  endTime: string;
  timezone?: string;
  reminderTime?: string;
  lateReminderMinutes?: number;
}

export interface TrainingOccurrence {
  date: string;
  startAt: number;
  endAt: number;
  reminderAt: number;
  lateReminderAt: number;
}

/** A moved occurrence may use a date with a different weekday; its identity is owned by storage. */
export function occurrence(series: TrainingSeries, date: string): TrainingOccurrence {
  const day = parseDate(date);
  const zone = series.timezone ?? DEFAULT_TIMEZONE;
  const startAt = localTimestamp(date, series.startTime, zone);
  const endAt = localTimestamp(date, series.endTime, zone);
  if (endAt <= startAt) throw new RangeError('Ende muss am selben Tag nach Beginn liegen.');
  const offset = series.lateReminderMinutes ?? 30;
  if (!Number.isInteger(offset) || offset < 0 || offset > 360)
    throw new RangeError('Ungültige Erinnerungszeit.');
  return {
    date,
    startAt,
    endAt,
    reminderAt: localTimestamp(
      day.subtract({ days: 1 }).toString(),
      series.reminderTime ?? '18:00',
      zone,
    ),
    lateReminderAt: startAt - offset * 60_000,
  };
}

/** Inclusive ISO calendar range, bounded to prevent accidental unbounded job generation. */
export function trainingDates(
  series: Pick<TrainingSeries, 'weekday'>,
  from: string,
  through: string,
): string[] {
  if (!Number.isInteger(series.weekday) || series.weekday < 1 || series.weekday > 7)
    throw new RangeError('Wochentag muss 1–7 sein.');
  let current = parseDate(from);
  const end = parseDate(through);
  if (Temporal.PlainDate.compare(current, end) > 0) throw new RangeError('Ungültiger Zeitraum.');
  if (current.until(end).days > 3660) throw new RangeError('Zeitraum ist zu groß.');
  current = current.add({ days: (series.weekday - current.dayOfWeek + 7) % 7 });
  const result: string[] = [];
  while (Temporal.PlainDate.compare(current, end) <= 0) {
    result.push(current.toString());
    current = current.add({ days: 7 });
  }
  return result;
}

export function normalizeEmoji(value: string): string {
  return value.trim().replace(/[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '');
}

export interface LateIntent {
  kind: 'late' | 'punctual' | 'absent' | 'uncertain' | 'none';
  minutes?: number;
  arrivalTime?: string;
}

/** Conservative German patterns. Callers must establish a unique training context first. */
export function parseLateIntent(input: string): LateIntent {
  const text = input
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/verspae?te?\s+mich/g, 'verspaete mich')
    .replace(/\s+/g, ' ')
    .trim();
  const late = /\b(?:spae?t(?:er)?|verspaet\w*|verspaetung)\b/.test(text);
  const arrival =
    /\b(?:schaffe|komme|komm|bin|werde)\b.*\b(?:erst|gegen)\s+(?:um\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(
      text,
    );
  const self =
    /\b(?:ich|wir)\s+(?:(?:heute|morgen|leider|wohl|etwas|ein\s+bisschen|bisschen)\s+)*(?:komme?\b|kommen\b|bin\b|sind\b|werde\b|werden\b|schaffe\b|schaffen\b|verspaete\b|verspaeten\b|kann\b|koennte\b|wuerde\b|muss\b|habe\b)/.test(
      text,
    ) ||
    /\b(?:komme?|bin|werde|schaffe|kann|koennte|wuerde)\s+ich\b/.test(text) ||
    /\bverspaete\s+mich\b/.test(text) ||
    /^(?:bin\b|komme?\b|werde\b|schaffe\b|verspaete\b|kann\b)/.test(text);
  // A proper name, third person or an object never turns into a self-report.
  if (!self)
    return {
      kind: late && /^(?:spaeter|zu spaet|verspaetung)[.!]?$/u.test(text) ? 'uncertain' : 'none',
    };
  if (
    /\b(?:wenn|falls|vielleicht|eventuell|evtl|moeglicherweise|koennte|wuerde)\b/.test(text) ||
    text.includes('?')
  ) {
    return { kind: late || arrival || /\bkomme?\b/.test(text) ? 'uncertain' : 'none' };
  }
  if (
    /\b(?:nicht|keinesfalls|nie)\s+(?:mehr\s+)?(?:zu\s+)?spae?t(?:er)?\b/.test(text) ||
    /\b(?:keine|ohne)\s+verspaetung\b/.test(text) ||
    /\b(?:nicht\s+verspaete|verspaete\s+mich\s+nicht)\b/.test(text)
  )
    return { kind: 'punctual' };
  if (late && /\bnicht\b/.test(text) && !/\bnicht\s+(?:ganz\s+)?puenktlich\b/.test(text))
    return { kind: 'uncertain' };
  if (
    /\b(?:komme?|kann|schaffe)\b.*\b(?:nicht|kein)\b/.test(text) &&
    !/\bnicht\s+(?:ganz\s+)?puenktlich\b/.test(text)
  )
    return { kind: 'absent' };
  if (/\bpuenktlich\b/.test(text) && !/\bnicht\s+(?:ganz\s+)?puenktlich\b/.test(text))
    return { kind: 'punctual' };
  if (!late && !arrival && !/\bnicht\s+(?:ganz\s+)?puenktlich\b/.test(text))
    return { kind: 'none' };
  const result: LateIntent = { kind: 'late' };
  if (arrival) result.arrivalTime = `${arrival[1].padStart(2, '0')}:${arrival[2]}`;
  const numeric = /\d\s*[-–]\s*\d/.test(text)
    ? null
    : /\b(\d{1,3})\s*(?:min(?:uten)?\.?|minuten?)\b/.exec(text);
  const words: Record<string, number> = {
    fuenf: 5,
    zehn: 10,
    fuenfzehn: 15,
    zwanzig: 20,
    dreissig: 30,
  };
  const word = /\b(fuenf|zehn|fuenfzehn|zwanzig|dreissig)\s+minuten?\b/.exec(text);
  const minutes = numeric
    ? Number(numeric[1])
    : word
      ? words[word[1]]
      : /\bviertelstunde\b/.test(text)
        ? 15
        : /\bhalbe\s+stunde\b/.test(text)
          ? 30
          : undefined;
  if (minutes !== undefined && minutes > 0 && minutes <= 360) result.minutes = minutes;
  return result;
}

export interface ChangeStamp {
  id: string;
  timestamp: number;
  source: 'reaction' | 'private';
  targetId?: string;
}
export interface AttendanceState {
  attendance: 'yes' | 'no' | 'unknown';
  late: boolean;
  minutes?: number;
  attendanceStamp?: ChangeStamp;
  lateStamp?: ChangeStamp;
}
export interface AttendanceChange extends ChangeStamp {
  attendance?: 'yes' | 'no';
  late?: boolean;
  minutes?: number;
  remove?: boolean;
  /** Removing a clock on the separate lateness prompt does not withdraw participation. */
  removeLatenessOnly?: boolean;
  /** A replacement thumbs-up clears lateness only when that same reaction set it. */
  clearOwnLateness?: boolean;
}
export const emptyAttendance = (): AttendanceState => ({ attendance: 'unknown', late: false });

function newer(change: ChangeStamp, previous?: ChangeStamp): boolean {
  return (
    !previous ||
    change.timestamp > previous.timestamp ||
    (change.timestamp === previous.timestamp && change.id > previous.id)
  );
}

/** Each dimension keeps its own provenance, so old reaction removals cannot undo private answers. */
export function reduceAttendance(
  previous: AttendanceState,
  change: AttendanceChange,
): AttendanceState {
  if (!Number.isFinite(change.timestamp) || !change.id) return previous;
  const state = { ...previous };
  const stamp: ChangeStamp = {
    id: change.id,
    timestamp: change.timestamp,
    source: change.source,
    ...(change.targetId ? { targetId: change.targetId } : {}),
  };
  if (change.remove) {
    if (change.source !== 'reaction' || !change.targetId) return previous;
    const removable = (old?: ChangeStamp) =>
      old?.source === 'reaction' && old.targetId === change.targetId && newer(change, old);
    if (!change.removeLatenessOnly && removable(state.attendanceStamp)) {
      state.attendance = 'unknown';
      state.attendanceStamp = stamp;
    }
    if (removable(state.lateStamp)) {
      state.late = false;
      delete state.minutes;
      state.lateStamp = stamp;
    }
    return state;
  }
  if (
    change.clearOwnLateness &&
    change.source === 'reaction' &&
    change.targetId &&
    state.lateStamp?.source === 'reaction' &&
    state.lateStamp.targetId === change.targetId &&
    newer(change, state.lateStamp)
  ) {
    state.late = false;
    delete state.minutes;
    state.lateStamp = stamp;
  }
  if (change.attendance && newer(change, state.attendanceStamp)) {
    state.attendance = change.attendance;
    state.attendanceStamp = stamp;
    if (change.attendance === 'no' && newer(change, state.lateStamp)) {
      state.late = false;
      delete state.minutes;
      state.lateStamp = stamp;
    }
  }
  if (typeof change.late === 'boolean' && newer(change, state.lateStamp)) {
    state.late = change.late && state.attendance !== 'no';
    if (state.late && change.minutes !== undefined) state.minutes = change.minutes;
    else delete state.minutes;
    state.lateStamp = stamp;
  }
  return state;
}
