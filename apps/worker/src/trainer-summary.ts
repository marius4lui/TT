import { all, setting } from './db';
import { label, type Training } from './training';

export interface SummaryPreference {
  enabled: boolean;
  offsetMinutes: number;
  includeAbsent: boolean;
  includeLate: boolean;
  includeCounts: boolean;
  version: number;
}
export interface SummaryRow {
  user_id: string;
  enabled: number;
  offset_minutes: number;
  include_absent: number;
  include_late: number;
  include_counts: number;
  version: number;
  updated_at: number;
}
export function preference(row?: SummaryRow | null): SummaryPreference {
  return {
    enabled: !!row?.enabled,
    offsetMinutes: row?.offset_minutes ?? 10,
    includeAbsent: row ? !!row.include_absent : true,
    includeLate: row ? !!row.include_late : true,
    includeCounts: row ? !!row.include_counts : true,
    version: row?.version ?? 0,
  };
}
export async function attendanceSnapshot(db: D1Database, t: Training) {
  const botJid = await setting(db, 'bot_jid');
  const rows = await all<{
    userId: string;
    name: string;
    response: string;
    punctuality: string;
    minutes: number | null;
    needsConfirmation: number;
    updatedAt: number;
    phoneJid: string | null;
  }>(
    db,
    `SELECT u.id AS userId,u.display_name AS name,COALESCE(a.response,'unknown') AS response,COALESCE(a.punctuality,'unknown') AS punctuality,a.minutes,COALESCE(a.needs_confirmation,0) AS needsConfirmation,COALESCE(a.updated_at,0) AS updatedAt,
     COALESCE(CASE WHEN u.jid LIKE '%@s.whatsapp.net' THEN u.jid END,(SELECT jid FROM identity_aliases WHERE user_id=u.id AND jid LIKE '%@s.whatsapp.net' ORDER BY jid LIMIT 1)) AS phoneJid
     FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN attendance a ON a.user_id=u.id AND a.session_id=? WHERE m.group_jid=? AND m.active=1 AND u.jid!=? AND NOT EXISTS(SELECT 1 FROM identity_aliases bot WHERE bot.user_id=u.id AND bot.jid=?) ORDER BY u.display_name,u.id`,
    t.id,
    t.group_jid,
    botJid,
    botJid,
  );
  const participants = rows.map(({ phoneJid, ...r }) => {
    const phoneDigits = /^(\d{5,20})@s\.whatsapp\.net$/.exec(phoneJid ?? '')?.[1];
    return {
      ...r,
      name:
        r.name.trim() ||
        `Mitglied · ${phoneDigits ? `…${phoneDigits.slice(-4)}` : r.userId.slice(0, 4)}`,
      needsConfirmation: !!r.needsConfirmation,
    };
  });
  return {
    participants,
    counts: {
      yes: rows.filter((r) => r.response === 'yes' && !r.needsConfirmation).length,
      no: rows.filter((r) => r.response === 'no' && !r.needsConfirmation).length,
      late: rows.filter(
        (r) => r.response !== 'no' && r.punctuality === 'late' && !r.needsConfirmation,
      ).length,
      unanswered: rows.filter((r) => r.response === 'unknown' || !!r.needsConfirmation).length,
      total: rows.length,
    },
  };
}
export async function renderTrainerSummary(
  db: D1Database,
  t: Training,
  p: SummaryRow,
): Promise<string> {
  const { participants, counts } = await attendanceSnapshot(db, t);
  const lines = [`🏓 *Trainerübersicht*\n${label(t)}`];
  if (p.include_counts)
    lines.push(
      `Zusagen: ${counts.yes} · Absagen: ${counts.no} · Offen/erneut bestätigen: ${counts.unanswered} · Mitglieder: ${counts.total}`,
    );
  if (p.include_absent)
    lines.push(
      `Absagen: ${
        participants
          .filter((r) => r.response === 'no' && !r.needsConfirmation)
          .map((r) => r.name)
          .join(', ') || 'keine'
      }`,
    );
  if (p.include_late)
    lines.push(
      `Verspätungen: ${
        participants
          .filter((r) => r.response !== 'no' && r.punctuality === 'late' && !r.needsConfirmation)
          .map((r) => `${r.name}${r.minutes ? ` (ca. ${r.minutes} Min.)` : ''}`)
          .join(', ') || 'keine'
      }`,
    );
  lines.push(
    'Aktueller Stand zum Versandzeitpunkt. Persönliche Trainerübersichten kannst du im Trainerbereich ausschalten.',
  );
  return lines.join('\n\n');
}
export async function planTrainerSummaries(db: D1Database, now: number): Promise<void> {
  if ((await setting(db, 'enabled')) !== '1' || (await setting(db, 'privacy_ready')) !== '1')
    return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,session_id,session_version,kind,text,due_at,expires_at,created_at,preference_version)
    SELECT lower(hex(randomblob(16))),s.id||':'||s.version||':trainer-summary:'||u.id||':'||p.version,u.jid,u.id,s.id,s.version,'trainer_summary','',s.start_at-p.offset_minutes*60000,MIN(s.end_at,s.start_at+900000),?,p.version
    FROM training_sessions s JOIN groups g ON g.jid=s.group_jid CROSS JOIN trainer_summary_preferences p JOIN users u ON u.id=p.user_id JOIN roles r ON r.user_id=u.id
    WHERE g.active=1 AND s.status='scheduled' AND p.enabled=1 AND r.role IN ('owner','admin') AND s.start_at-p.offset_minutes*60000<=? AND MIN(s.end_at,s.start_at+900000)>? AND p.updated_at<=s.start_at-p.offset_minutes*60000
    AND (SELECT accepted FROM consents WHERE user_id=u.id AND purpose='trainer_summary' ORDER BY created_at DESC,rowid DESC LIMIT 1)=1`,
    )
    .bind(now, now, now)
    .run();
}
