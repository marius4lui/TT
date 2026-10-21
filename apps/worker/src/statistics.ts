import { Temporal } from '@js-temporal/polyfill';
import { normalizeLanguage } from '@tt/core';
import { all, setting } from './db';
import type { BotContext } from './types';

export type StatisticsMonths = 1 | 6 | 12;
export interface StatisticsRequest {
  months: StatisticsMonths[];
}
export interface StatisticsPeriod {
  months: StatisticsMonths;
  from: number;
  until: number;
}
export interface StatisticsStanding {
  userId: string;
  name: string;
  score: number;
  signups: number;
  confirmed: number;
  rank: number;
}

/** Explicit commands only: ordinary conversation must never trigger a ranking. */
export function parseStatisticsRequest(input: string): StatisticsRequest | null {
  if (input.length > 120) return null;
  const match = /^\/?(?:stats|statistik|statistiken|analyse|analysen)(?:\s+(.+?))?[?!.]*$/.exec(
    normalizeLanguage(input).trim(),
  );
  if (!match) return null;
  const period = match[1]
    ?.replace(/[?!.]+$/, '')
    .trim()
    .replace(/^letzt(?:e|en|es)\s+/, '');
  if (!period) return { months: [6] };
  if (/^(?:1|ein(?:en)?)?\s*monat$/.test(period)) return { months: [1] };
  if (/^(?:6|sechs)\s*monate[n]?$|^halbjahr$/.test(period)) return { months: [6] };
  if (/^(?:12|zwoelf)\s*monate[n]?$|^(?:1\s+)?jahr$/.test(period)) return { months: [12] };
  return null;
}

export function statisticsPeriods(
  now: number,
  timezone: string,
  months: StatisticsMonths[] = [1, 6, 12],
): StatisticsPeriod[] {
  const end = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timezone);
  return months.map((value) => ({
    months: value,
    from: end.subtract({ months: value }).epochMilliseconds,
    until: now,
  }));
}

/** WhatsApp supplies an unstructured display name, never a verified given name. */
export function statisticsFirstName(name: string): string {
  const clean = name.normalize('NFC').trim();
  if (/[\p{Cc}\p{Cf}<>@:/\\]|\d|["„“]/u.test(clean) || clean.includes(',')) return 'Mitglied';
  const first = clean.split(/\s+/u)[0] ?? '';
  return /^[\p{L}\p{M}]+(?:[-’'][\p{L}\p{M}]+)*$/u.test(first) && first.length <= 30
    ? first
    : 'Mitglied';
}

/** Authorization stays in SQL, including for direct callers and changed memberships. */
export async function getGroupStatistics(
  ctx: BotContext,
  groupJid: string,
  period: StatisticsPeriod,
): Promise<StatisticsStanding[]> {
  return loadStandings(ctx.env.DB, groupJid, period, ctx);
}

export async function loadStandings(
  db: D1Database,
  groupJid: string,
  period: StatisticsPeriod,
  ctx?: BotContext,
): Promise<StatisticsStanding[]> {
  const botJid = await setting(db, 'bot_jid');
  const rows = await all<Omit<StatisticsStanding, 'rank'>>(
    db,
    `SELECT u.id AS userId,COALESCE(n.first_name,'Mitglied') AS name,
      SUM(CASE WHEN p.state='present' THEN 1 WHEN p.state='absent' THEN 0
        WHEN a.response='yes' AND a.needs_confirmation=0 THEN 1 ELSE 0 END) AS score,
      SUM(CASE WHEN a.response='yes' AND a.needs_confirmation=0 THEN 1 ELSE 0 END) AS signups,
      SUM(CASE WHEN p.state='present' THEN 1 ELSE 0 END) AS confirmed
    FROM training_sessions s JOIN groups g ON g.jid=s.group_jid AND g.active=1
    JOIN memberships m ON m.group_jid=g.jid AND m.active=1
    JOIN users u ON u.id=m.user_id
    LEFT JOIN group_first_names n ON n.group_jid=g.jid AND n.user_id=u.id
    LEFT JOIN attendance a ON a.session_id=s.id AND a.user_id=u.id
    LEFT JOIN session_presence p ON p.session_id=s.id AND p.user_id=u.id
    WHERE g.jid=? AND NOT EXISTS(SELECT 1 FROM practice_groups pg WHERE pg.group_jid=g.jid) AND s.status='scheduled' AND s.start_at>=? AND s.end_at<=?
      AND s.start_at<? AND s.end_at>s.start_at
      AND (? IS NULL OR EXISTS(SELECT 1 FROM memberships viewer WHERE viewer.group_jid=g.jid AND viewer.user_id=? AND viewer.active=1))
      AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')
      AND (?=0 OR g.jid=?)
      AND NOT EXISTS(SELECT 1 FROM roles r WHERE r.user_id=u.id AND r.role IN ('owner','admin'))
      AND u.jid!=? AND NOT EXISTS(SELECT 1 FROM identity_aliases b WHERE b.user_id=u.id AND b.jid=?)
    GROUP BY u.id,n.first_name HAVING score>0 ORDER BY score DESC,name,u.id`,
    groupJid,
    period.from,
    period.until,
    period.until,
    ctx?.user.id ?? null,
    ctx?.user.id ?? null,
    ctx?.isGroup ? 1 : 0,
    ctx?.chatJid ?? groupJid,
    botJid,
    botJid,
  );
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.score !== rows[index - 1].score) rank = index + 1;
    return { ...row, name: statisticsFirstName(row.name), rank };
  });
}

export async function answerStatistics(
  ctx: BotContext,
): Promise<{ text: string; groupJid?: string; months?: StatisticsMonths } | null> {
  const request = parseStatisticsRequest(ctx.text);
  if (!request) return null;
  if ((await setting(ctx.env.DB, 'privacy_ready')) !== '1')
    return { text: 'Statistiken sind noch nicht freigegeben.' };
  const groups = await all<{ jid: string; name: string }>(
    ctx.env.DB,
    `SELECT g.jid,g.name FROM groups g JOIN memberships m ON m.group_jid=g.jid
      WHERE g.active=1 AND NOT EXISTS(SELECT 1 FROM practice_groups pg WHERE pg.group_jid=g.jid) AND m.active=1 AND m.user_id=? AND (? IS NULL OR g.jid=?) ORDER BY g.jid`,
    ctx.user.id,
    ctx.isGroup ? ctx.chatJid : null,
    ctx.isGroup ? ctx.chatJid : null,
  );
  if (!groups.length) return { text: 'Für dich ist keine aktive Trainingsgruppe freigeschaltet.' };
  if (groups.length > 1)
    return {
      text: 'Du bist in mehreren Trainingsgruppen. Schreib „Stats“ bitte in der gewünschten Gruppe.',
    };
  const months = request.months.length === 1 ? request.months[0] : undefined;
  return {
    text: await renderGroupStatistics(ctx.env.DB, groups[0].jid, ctx.now, months),
    groupJid: groups[0].jid,
    months,
  };
}

export async function statisticsData(
  db: D1Database,
  groupJid: string,
  now: number,
  months: StatisticsMonths = 6,
) {
  const timezone = await setting(db, 'timezone', 'Europe/Berlin');
  const period = statisticsPeriods(now, timezone, [months])[0];
  const value = await setting(db, 'statistics_history_from');
  const historyFrom = Math.max(
    value && Number.isFinite(Number(value)) ? Number(value) : now,
    now - 400 * 86400000,
  );
  return {
    period,
    timezone,
    historyFrom,
    partial: historyFrom > period.from,
    rows: await loadStandings(db, groupJid, period),
  };
}

export function compactStatistics(
  rows: Pick<StatisticsStanding, 'rank' | 'name' | 'score'>[],
  months: StatisticsMonths,
  options: { demo?: boolean; partial?: boolean; url?: string } = {},
): string {
  const entries = rows.slice(0, 3).map((r) => `${r.rank}. ${r.name} · ${r.score}×`);
  return [
    `${options.demo ? '🧪 *Demo-Statistik' : '🏓 *Trainingsstatistik'} · ${months} ${months === 1 ? 'Monat' : 'Monate'}*`,
    entries.join('\n') || 'Noch keine zählbaren Teilnahmen.',
    options.demo ? 'Fiktive Beispielwerte.' : 'Nach Zusagen, mit Trainerkorrekturen. Ohne Trainer.',
    options.partial ? '⚠️ Ältere Daten fehlen – vorläufig.' : '',
    rows.length > 3 && rows[3].rank === rows[2].rank
      ? 'Weitere punktgleiche Personen in der Tabelle.'
      : '',
    options.url ? `Ganze Tabelle: ${options.url}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Internal renderer; callers must authorize the recipient before delivery. */
export async function renderGroupStatistics(
  db: D1Database,
  groupJid: string,
  now: number,
  months: StatisticsMonths = 6,
): Promise<string> {
  const group = await db
    .prepare(
      'SELECT 1 FROM groups g WHERE g.jid=? AND g.active=1 AND NOT EXISTS(SELECT 1 FROM practice_groups p WHERE p.group_jid=g.jid)',
    )
    .bind(groupJid)
    .first();
  if (!group || (await setting(db, 'privacy_ready')) !== '1')
    return 'Statistiken sind nicht verfügbar.';
  const data = await statisticsData(db, groupJid, now, months);
  return compactStatistics(data.rows, months, { partial: data.partial });
}
