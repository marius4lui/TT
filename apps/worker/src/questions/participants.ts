import type { BotContext } from '../types';
import { dateInZone, label } from '../training';
import { attendanceSnapshot } from '../trainer-summary';
import { loadQuestionTrainings, questionText } from './common';

/** A read-only roster, limited to the sender's current groups. */
export async function answerParticipants(ctx: BotContext): Promise<string | null> {
  const text = questionText(ctx.text)
    ?.replace(/[?!.]+$/, '')
    .trim();
  if (
    !text ||
    !/^wer (?:kommt(?: (?:heute|morgen))?(?: alles)?|ist(?: (?:heute|morgen))?(?: alles)? dabei|hat(?: alles)? zugesagt)(?: (?:heute|morgen))?(?: (?:zum|beim) training)?$/.test(
      text,
    )
  )
    return null;
  const scope = /\bmorgen\b/.test(text)
    ? { day: 'tomorrow' as const }
    : /\bheute\b/.test(text)
      ? { day: 'today' as const }
      : {};
  const available = await loadQuestionTrainings(ctx, scope);
  if (!available.length)
    return 'Ich finde dafür keinen anstehenden Termin in deinen Trainingsgruppen. Frag deinen Trainer nach der aktuellen Einladung.';
  const relevant = scope.day
    ? available
    : available.filter(
        (t) =>
          dateInZone(t.start_at, t.timezone) ===
          dateInZone(available[0].start_at, available[0].timezone),
      );
  if (new Set(relevant.map((t) => t.group_jid)).size > 1)
    return 'Für dich gibt es mehrere passende Trainingsgruppen. Frag bitte direkt in der jeweiligen Trainingsgruppe „Wer kommt?“, damit die Liste eindeutig ist.';
  const training = available[0];
  if (training.status === 'cancelled') return `*Training abgesagt*\n${label(training, true)}`;
  const { participants, counts } = await attendanceSnapshot(ctx.env.DB, training);
  const yes = participants.filter((p) => p.response === 'yes' && !p.needsConfirmation);
  const names = yes
    .slice(0, 30)
    .map(
      (p) =>
        `• ${p.name.replace(/[\n\r*_~`]/g, ' ').trim()}${p.punctuality === 'late' ? ` – später${p.minutes ? ` (ca. ${p.minutes} Min.)` : ''}` : ''}`,
    );
  if (yes.length > 30) names.push(`… und ${yes.length - 30} weitere.`);
  return [
    `*Wer kommt?*\n${label(training, true)}`,
    `*Zusagen: ${counts.yes}*\n${names.join('\n') || 'Bisher hat noch niemand zugesagt.'}`,
    `Absagen: ${counts.no}\nNoch offen / erneut bestätigen: ${counts.unanswered}`,
  ].join('\n\n');
}
