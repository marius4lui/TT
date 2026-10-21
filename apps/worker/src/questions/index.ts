import type { BotContext } from '../types';
import { answerParticipants } from './participants';
import { answerOwnAttendance } from './attendance';
import { answerDetails } from './details';
import { answerSchedule } from './schedule';

/** At most one answer; questions never enter the attendance mutation path. */
export async function answerTrainingQuestion(ctx: BotContext): Promise<string | null> {
  const participants = await answerParticipants(ctx);
  if (participants !== null) return participants;
  const own = await answerOwnAttendance(ctx);
  if (own !== null) return ctx.isGroup ? `${ctx.user.display_name || 'Mitglied'}: ${own}` : own;
  const details = await answerDetails(ctx);
  if (details !== null) return details;
  return answerSchedule(ctx);
}
