import type { Hono } from 'hono';
import type { AppBindings } from './types';
import { hashToken } from './security';
import { setting } from './db';
import { compactStatistics, statisticsData, type StatisticsMonths } from './statistics';

interface Link {
  group_jid: string | null;
  requester_id: string | null;
  practice_id: string | null;
  practice_version: number | null;
  months: StatisticsMonths;
  expires_at: number;
}
const week = 7 * 86400000;
export function demoStatistics(months: StatisticsMonths) {
  const values =
    months === 1
      ? [4, 3, 3, 2, 2, 1]
      : months === 6
        ? [24, 21, 21, 18, 12, 9]
        : [48, 42, 42, 36, 24, 18];
  const names = ['Alex', 'Kim', 'Sam', 'Toni', 'Robin', 'Charlie'];
  let rank = 0;
  return values.map((score, index) => {
    if (!index || score !== values[index - 1]) rank = index + 1;
    return { name: names[index], score, rank };
  });
}
async function allowed(db: D1Database, link: Link, now: number) {
  if (link.expires_at <= now) return false;
  if (link.practice_id)
    return !!(await db
      .prepare(
        `SELECT 1 FROM practice_groups p JOIN roles r ON r.user_id=p.owner_id
    WHERE p.id=? AND p.version=? AND p.phase='active' AND p.status='ready' AND p.expires_at>?`,
      )
      .bind(link.practice_id, link.practice_version, now)
      .first());
  if ((await setting(db, 'privacy_ready')) !== '1') return false;
  return !!(await db
    .prepare(
      `SELECT 1 FROM groups g JOIN memberships m ON m.group_jid=g.jid
    WHERE g.jid=? AND g.active=1 AND m.user_id=? AND m.active=1
    AND NOT EXISTS(SELECT 1 FROM practice_groups p WHERE p.group_jid=g.jid)`,
    )
    .bind(link.group_jid, link.requester_id)
    .first());
}
/** Bearer links: opaque 128-bit token, only its digest is kept in D1. */
export async function createStatisticsLink(
  db: D1Database,
  input: Omit<Link, 'expires_at'> & { expires_at?: number },
  now: number,
) {
  const link: Link = { ...input, expires_at: Math.min(input.expires_at ?? now + week, now + week) };
  if (!(await allowed(db, link, now))) throw new Error('statistics_unavailable');
  const origin = new URL(await setting(db, 'origin'));
  if (
    origin.protocol !== 'https:' &&
    origin.hostname !== 'localhost' &&
    origin.hostname !== '127.0.0.1'
  )
    throw new Error('invalid_origin');
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  await db
    .prepare(
      `INSERT INTO statistics_links(token_hash,group_jid,requester_id,practice_id,practice_version,months,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)`,
    )
    .bind(
      await hashToken(token),
      link.group_jid,
      link.requester_id,
      link.practice_id,
      link.practice_version,
      link.months,
      now,
      link.expires_at,
    )
    .run();
  return `${origin.origin}/s/${token}`;
}
export async function linkedStatisticsReply(
  db: D1Database,
  groupJid: string,
  requester: string,
  now: number,
  months: StatisticsMonths = 6,
) {
  const url = await createStatisticsLink(
    db,
    {
      group_jid: groupJid,
      requester_id: requester,
      practice_id: null,
      practice_version: null,
      months,
    },
    now,
  );
  const data = await statisticsData(db, groupJid, now, months);
  return compactStatistics(data.rows, months, { partial: data.partial, url });
}
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function document(body: string) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Trainingsstatistik · TT</title><link rel="stylesheet" href="/style.css"></head><body class="reading-page"><main class="statistics-page">${body}</main></body></html>`;
}
export function registerStatisticsRoutes(app: Hono<AppBindings>) {
  app.get('/s/:token', async (c) => {
    c.header('Cache-Control', 'no-store, private');
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('Referrer-Policy', 'no-referrer');
    const token = c.req.param('token');
    const fail = () =>
      c.html(
        document(
          '<h1>Link nicht verfügbar</h1><p>Dieser Link ist ungültig oder abgelaufen. Schreibe in deiner Trainingsgruppe erneut „Stats“.</p>',
        ),
        404,
      );
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return fail();
    const link = await c.env.DB.prepare('SELECT * FROM statistics_links WHERE token_hash=?')
      .bind(await hashToken(token))
      .first<Link>();
    const now = Date.now();
    if (!link || !(await allowed(c.env.DB, link, now))) return fail();
    const query = c.req.query('months');
    const months = query === undefined ? link.months : (Number(query) as StatisticsMonths);
    if (![1, 6, 12].includes(months)) return fail();
    const demo = !!link.practice_id;
    const data = demo ? null : await statisticsData(c.env.DB, link.group_jid!, now, months);
    const rows = demo ? demoStatistics(months) : data!.rows;
    const format = (ms: number) =>
      new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: data?.timezone ?? 'Europe/Berlin',
      }).format(ms);
    // Recheck issuer/group after reading the table as well.
    if (!(await allowed(c.env.DB, link, Date.now()))) return fail();
    return c.html(
      document(`
      <p class="eyebrow">${demo ? 'DEMO · FIKTIVE BEISPIELWERTE' : 'DEINE TRAININGSGRUPPE'}</p>
      <h1>${demo ? 'Demo-Rangliste' : 'Trainingsstatistik'}</h1>
      <nav class="statistics-periods" aria-label="Zeitraum">${([1, 6, 12] as const).map((m) => `<a class="button button-outline" href="?months=${m}"${m === months ? ' aria-current="page"' : ''}>${m} ${m === 1 ? 'Monat' : 'Monate'}</a>`).join('')}</nav>
      <p>${demo ? 'Alle Namen und Werte sind erfunden. Sie zeigen, wie die echte Tabelle aussieht.' : `Rollierend: ${escape(format(data!.period.from))} – ${escape(format(data!.period.until))} (${escape(data!.timezone)})`}</p>
      ${data?.partial ? '<p class="notice-box">Ältere Rückmeldungen fehlen. Diese Rangliste ist vorläufig.</p>' : ''}
      <section class="content-card statistics-card"><table><caption>${months} ${months === 1 ? 'Monat' : 'Monate'} · vollständige Rangliste</caption><thead><tr><th scope="col">Platz</th><th scope="col">Vorname</th><th scope="col">Teilnahmen*</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.rank}</td><td>${escape(r.name)}</td><td>${r.score}</td></tr>`).join('') || '<tr><td colspan="3">Noch keine zählbaren Teilnahmen.</td></tr>'}</tbody></table></section>
      <p class="form-hint">* Nach Zusagen zu beendeten Trainings, mit optionalen Trainerkorrekturen. Aktuelle Trainer und Bot zählen nicht. Gleiche Punktzahlen erhalten denselben Rang.</p>
      <p class="form-hint">${demo ? 'Keine echten Trainingsdaten. Der Link endet mit dieser Übungsrunde.' : 'Namen werden aus Gruppen-Anzeigenamen auf den ersten Namensteil gekürzt; unbekannte Namen erscheinen als „Mitglied“. WhatsApp bestätigt keine Vornamen.'}</p>
      <p class="form-hint">Jeder mit diesem Link kann die Tabelle ansehen. Gültig bis ${escape(format(link.expires_at))}. Die Tabelle wird beim Öffnen aktualisiert.</p><footer><a href="/datenschutz">Datenschutz</a> · <a href="/source">Quellcode · AGPL-3.0</a></footer>`),
    );
  });
}
