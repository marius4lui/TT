import type { BotContext } from '../types';
import { dateInZone } from '../training';
import { loadQuestionTrainings, questionText, trainingDescription } from './common';

interface OwnAttendance {
  response: string;
  punctuality: string;
  minutes: number | null;
  arrival_time: string | null;
  needs_confirmation: number;
}

function ownStatusScope(input: string): { day?: 'today' | 'tomorrow'; next?: boolean } | null {
  const normalized = questionText(input);
  if (!normalized) return null;
  let text = normalized.replace(/[?!.]+$/u, '').trim();
  const today = /\b(?:heute|heutige[nms]?)\b/u.test(text);
  const tomorrow = /\b(?:morgen|morgige[nms]?)\b/u.test(text);
  const next = /\b(?:naechst(?:e|en|es|em)|naechstes mal)\b/u.test(text);
  if ((today && tomorrow) || (next && (today || tomorrow))) return null;
  const trainingContext = /\b(?:training|tischtennis|teilnahme|trainingsstatus)\b/u.test(text);
  // Only known question fillers and training qualifiers may be omitted. An unrelated
  // object (for example a newsletter or a doctor's appointment) keeps the match closed.
  text = text
    .replace(/^(?:sag mal|kurze frage|eine frage|hey|hallo|bot)[,:]?\s+/u, '')
    .replace(
      /\b(?:fuers|fuer das|beim|zum|am|im|fuer|bei dem|bei)\s+(?:(?:naechsten|naechste|naechstes|naechstem|heutigen|morgigen|heutige|morgige)\s+)?(?:training|tischtennis)\b/gu,
      ' ',
    )
    .replace(/\bfuer (?=heute\b|morgen\b)/gu, '')
    .replace(
      /\b(?:heute|morgen|denn|eigentlich|noch|schon|bereits|jetzt|aktuell|gerade|nochmal|noch mal|nun)\b/gu,
      ' ',
    )
    .replace(/\s+/gu, ' ')
    .trim();
  const simple =
    /^(?:bin ich (?:angemeldet|abgemeldet|eingetragen|(?:mit )?dabei|als (?:verspaetet|puenktlich) (?:eingetragen|gemeldet))|(?:habe|hab) ich (?:(?:zu|ab)gesagt|mich (?:an|ab)gemeldet|meine teilnahme bestaetigt)|wie bin ich (?:eingetragen|gemeldet|angemeldet)|(?:ist|wurde) meine (?:zu|ab)sage (?:eingetragen|gespeichert)|(?:ist|wurde) meine verspaetung (?:eingetragen|gespeichert))$/u;
  const status =
    trainingContext &&
    /^(?:was ist mein (?:status|teilnahmestatus|trainingsstatus)|wie ist mein (?:status|teilnahmestatus|trainingsstatus)|was habe ich angegeben)$/u.test(
      text,
    );
  if (!simple.test(text) && !status) return null;
  return today ? { day: 'today' } : tomorrow ? { day: 'tomorrow' } : next ? { next: true } : {};
}

function statusDescription(row: OwnAttendance | null): string {
  if (!row) return 'Du hast noch nicht zugesagt oder abgesagt.';
  let status =
    row.response === 'no'
      ? 'Du hast abgesagt.'
      : row.response === 'yes'
        ? 'Du hast zugesagt.'
        : 'Du hast noch nicht zugesagt oder abgesagt.';
  if (row.response !== 'no' && row.punctuality === 'late') {
    status += row.arrival_time
      ? ` Ankunft gegen ${row.arrival_time} Uhr.`
      : row.minutes !== null && row.minutes > 0
        ? ` Du kommst etwa ${row.minutes} Minuten später.`
        : ' Du bist als verspätet eingetragen.';
  } else if (row.response === 'yes' && row.punctuality === 'punctual') {
    status += ' Du bist als pünktlich eingetragen.';
  }
  return row.needs_confirmation
    ? `Bisher: ${status} Der Termin wurde geändert. Bitte bestätige deine Teilnahme erneut.`
    : status;
}

/** Read-only: a question about a previous response never becomes a new response. */
export async function answerOwnAttendance(ctx: BotContext): Promise<string | null> {
  const scope = ownStatusScope(ctx.text);
  if (!scope) return null;
  const available = await loadQuestionTrainings(ctx, scope);
  if (!available.length) {
    return scope.day === 'today'
      ? 'Für heute finde ich keinen anstehenden Trainingstermin für dich.'
      : scope.day === 'tomorrow'
        ? 'Für morgen finde ich keinen Trainingstermin für dich.'
        : 'Ich finde aktuell keinen anstehenden Trainingstermin für dich.';
  }
  const relevant = scope.day
    ? available
    : available.filter(
        (training) =>
          dateInZone(training.start_at, training.timezone) ===
          dateInZone(available[0].start_at, available[0].timezone),
      );
  const entries: string[] = [];
  const multipleGroups = new Set(relevant.map((training) => training.group_jid)).size > 1;
  for (const training of relevant.slice(0, 3)) {
    const row =
      training.status === 'cancelled'
        ? null
        : await ctx.env.DB.prepare(
            'SELECT response,punctuality,minutes,arrival_time,needs_confirmation FROM attendance WHERE session_id=? AND user_id=?',
          )
            .bind(training.id, ctx.user.id)
            .first<OwnAttendance>();
    entries.push(
      `${multipleGroups ? `${training.group_name} · ` : ''}${trainingDescription(training)}\n${
        training.status === 'cancelled'
          ? 'Dieses Training fällt aus. Eine Zusage ist nicht erforderlich.'
          : statusDescription(row)
      }`,
    );
  }
  if (relevant.length > 3)
    entries.push(
      'Es gibt weitere Termine an diesem Tag. Frag bitte in der jeweiligen Trainingsgruppe nach deinem Status.',
    );
  return entries.join('\n\n');
}
