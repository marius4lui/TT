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
  if (!period) return { months: [1, 6, 12] };
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

const safeName = (name: string) =>
  name
    .replace(/[\p{Cc}\p{Cf}*_~`]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'Mitglied';

/** Authorization stays in SQL, including for direct callers and changed memberships. */
export async function getGroupStatistics(
  ctx: BotContext,
  groupJid: string,
  period: StatisticsPeriod,
): Promise<StatisticsStanding[]> {
  return loadStandings(ctx.env.DB, groupJid, period, ctx);
}

async function loadStandings(
  db: D1Database,
  groupJid: string,
  period: StatisticsPeriod,
  ctx?: BotContext,
): Promise<StatisticsStanding[]> {
  const botJid = await setting(db, 'bot_jid');
  const rows = await all<Omit<StatisticsStanding, 'rank'>>(
    db,
    `SELECT u.id AS userId,u.display_name AS name,
      SUM(CASE WHEN p.state='present' THEN 1 WHEN p.state='absent' THEN 0
        WHEN a.response='yes' AND a.needs_confirmation=0 THEN 1 ELSE 0 END) AS score,
      SUM(CASE WHEN a.response='yes' AND a.needs_confirmation=0 THEN 1 ELSE 0 END) AS signups,
      SUM(CASE WHEN p.state='present' THEN 1 ELSE 0 END) AS confirmed
    FROM training_sessions s JOIN groups g ON g.jid=s.group_jid AND g.active=1
    JOIN memberships m ON m.group_jid=g.jid AND m.active=1
    JOIN users u ON u.id=m.user_id
    LEFT JOIN attendance a ON a.session_id=s.id AND a.user_id=u.id
    LEFT JOIN session_presence p ON p.session_id=s.id AND p.user_id=u.id
    WHERE g.jid=? AND NOT EXISTS(SELECT 1 FROM practice_groups pg WHERE pg.group_jid=g.jid) AND s.status='scheduled' AND s.start_at>=? AND s.end_at<=?
      AND s.start_at<? AND s.end_at>s.start_at
      AND (? IS NULL OR EXISTS(SELECT 1 FROM memberships viewer WHERE viewer.group_jid=g.jid AND viewer.user_id=? AND viewer.active=1))
      AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')
      AND (?=0 OR g.jid=?)
      AND NOT EXISTS(SELECT 1 FROM roles r WHERE r.user_id=u.id AND r.role IN ('owner','admin'))
      AND u.jid!=? AND NOT EXISTS(SELECT 1 FROM identity_aliases b WHERE b.user_id=u.id AND b.jid=?)
    GROUP BY u.id,u.display_name HAVING score>0 ORDER BY score DESC,u.display_name,u.id`,
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
    return { ...row, name: safeName(row.name), rank };
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

/** Internal renderer; callers must authorize the recipient before delivery. */
export async function renderGroupStatistics(
  db: D1Database,
  groupJid: string,
  now: number,
  months?: StatisticsMonths,
): Promise<string> {
  const group = await db
    .prepare(
      'SELECT g.name FROM groups g WHERE g.jid=? AND g.active=1 AND NOT EXISTS(SELECT 1 FROM practice_groups pg WHERE pg.group_jid=g.jid)',
    )
    .bind(groupJid)
    .first<{ name: string }>();
  if (!group || (await setting(db, 'privacy_ready')) !== '1')
    return 'Statistiken sind nicht verfügbar.';
  const timezone = await setting(db, 'timezone', 'Europe/Berlin');
  const historyValue = await setting(db, 'statistics_history_from');
  const history = Math.max(
    historyValue && Number.isFinite(Number(historyValue)) ? Number(historyValue) : now,
    now - 400 * 86400000,
  );
  const format = (timestamp: number) =>
    new Intl.DateTimeFormat('de-DE', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  const lines = [
    `🏓 *Trainingsstatistik · ${safeName(group.name)}*`,
    'Nach Zusagen, mit Trainerkorrekturen. Keine vollständig bestätigte Anwesenheitsliste. Nur beendete, nicht abgesagte Trainings; aktuelle Mitglieder ohne Trainer und Bot.',
  ];
  for (const period of statisticsPeriods(now, timezone, months ? [months] : undefined)) {
    const rows = await loadStandings(db, groupJid, period);
    const partial = history > period.from;
    const entries = rows.slice(0, 10).map((r) => `${r.rank}. ${r.name}: ${r.score}`);
    if (rows.length > 10)
      entries.push(`… ${rows.length - 10} weitere Mitglieder; gleiche Anzahl = gleicher Rang.`);
    lines.push(
      `*${period.months === 1 ? 'Letzter Monat (rollierend)' : `Letzte ${period.months} Monate (rollierend)`}*\n${format(period.from)} – ${format(period.until)} (${timezone})\n${
        partial
          ? `⚠️ Zeitraum nur teilweise erfasst. Verlässlicher Datenzeitraum ab ${format(history)}; ältere gelöschte Rückmeldungen fehlen. Kein abschließendes Ergebnis.\n`
          : ''
      }${entries.join('\n') || 'Keine zählbaren Zusagen oder bestätigten Teilnahmen im gespeicherten Zeitraum.'}`,
    );
  }
  lines.push(
    'Gezählt: Trainerbestätigung „anwesend“ = 1, „abwesend“ = 0; sonst gültige Zusage = 1. Gleichstand bleibt geteilt. Keine automatische Auszeichnung.',
  );
  return lines.join('\n\n');
}
