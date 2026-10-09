import { normalizeLanguage, parseDate } from '@tt/core';
import { all, setting } from '../db';
import { dateInZone, label, type Training } from '../training';
import type { BotContext } from '../types';

export type QuestionTraining = Training & { group_name: string };
export type QuestionScope = { day?: 'today' | 'tomorrow'; next?: boolean };

/** Shared exclusions, not a general question detector. Each field still needs
 * an anchored, explicit training question before reading any training data. */
export function questionText(input: string): string | null {
  if (!input.trim() || input.length > 400) return null;
  const text = normalizeLanguage(input);
  if (
    /["„“»«<>]|https?:\/\/|\n\s*>/.test(input) ||
    /\b(?:sagt|sagte|fragt|fragte|meint|meinte|geschrieben|gesagt|gefragt|behauptet|zitiert|wenn|falls|vielleicht|eventuell|wuerde|koennte|gestern|vorgestern|damals)\b/.test(
      text,
    ) ||
    /\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende|woche|monat|jahr|uebermorgen|tagen?|januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|\b(?:am|zum)\s+(?:\d|ersten|zweiten|dritten|(?:mo|di|mi|do|fr|sa|so)\b)|\b\d{1,4}[/.\-]\d{1,2}/.test(
      text,
    ) ||
    (/\bheute\b/.test(text) && /\bmorgen\b/.test(text))
  )
    return null;
  return text;
}

/** Read only: user membership filtering happens in SQL before any selection.
 * A private chat can see its own groups; a group can see only that group. */
export async function loadQuestionTrainings(
  ctx: BotContext,
  scope: QuestionScope = {},
): Promise<QuestionTraining[]> {
  if ((await setting(ctx.env.DB, 'privacy_ready')) !== '1') return [];
  const rows = await all<QuestionTraining>(
    ctx.env.DB,
    `SELECT s.*,g.name AS group_name FROM training_sessions s
      JOIN groups g ON g.jid=s.group_jid AND g.active=1
      JOIN memberships m ON m.group_jid=s.group_jid AND m.user_id=? AND m.active=1
      WHERE s.end_at>? AND (? IS NULL OR s.group_jid=?)
        AND (?=0 OR s.start_at>?)
      ORDER BY s.start_at,s.group_jid,s.id LIMIT 200`,
    ctx.user.id,
    ctx.now,
    ctx.isGroup ? ctx.chatJid : null,
    ctx.isGroup ? ctx.chatJid : null,
    scope.next ? 1 : 0,
    ctx.now,
  );
  return rows.filter((training) => {
    if (!scope.day) return true;
    const requestedDate = parseDate(dateInZone(ctx.now, training.timezone))
      .add({ days: scope.day === 'tomorrow' ? 1 : 0 })
      .toString();
    return dateInZone(training.start_at, training.timezone) === requestedDate;
  });
}

export function trainingDescription(training: QuestionTraining): string {
  return label(training);
}
