import type { BotContext } from '../types';
import {
  loadQuestionTrainings,
  questionText,
  trainingDescription,
  type QuestionTraining,
} from './common';

type ScheduleQuestion = { day?: 'today' | 'tomorrow'; next?: boolean; cancellation?: boolean };

/** Small, anchored question grammar: a mention of training alone is not a request. */
function scheduleQuestion(input: string, isGroup: boolean): ScheduleQuestion | null {
  if (/^\/termine\s*$/i.test(input) || (isGroup && /^\/training\s*$/i.test(input))) return {};
  const normalized = questionText(input);
  if (!normalized) return null;
  if (/^termine[?!.,]*$/.test(normalized)) return {};
  let text = normalized
    .replace(/[?!.,]+$/g, '')
    .replace(/^(?:(?:hey|hi|hallo|moin|huhu|sorry|kurze frage|frage)[,:]?\s+)+/, '')
    .replace(
      /^(?!ich\b|er\b|sie\b|du\b|wir\b|wenn\b|falls\b|heute\b|morgen\b|training\b|das\b|es\b|wo\b|wie\b|warum\b|wer\b|weshalb\b|wann\b|was\b)[\p{L}]+(?:[, :]?\s+(?=wann\b)|[:,]\s+(?=(?:ist|haben wir|findet|faellt)\b))/u,
      '',
    )
    .replace(/\b(?:das naechste|naechstes) mal\b/g, 'naechstes')
    .replace(/\bnoch ?ma\b/g, 'nochmal')
    .replace(/\bgibt['’]?s\b/g, 'gibt es')
    .trim();
  if (/\bheute\b/.test(text) && /\bmorgen\b/.test(text)) return null;
  // Deliberately refuse dates we cannot resolve. Never answer a Friday question with Saturday.
  if (
    /\b(?:uebermorgen|gestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|woche|monat|ferien)\b|\d/.test(
      text,
    )
  )
    return null;
  text = text.replace(
    /\b(?:tischtennistraining|tt-training|tischtennis-training|tt)\b/g,
    'training',
  );
  const filler =
    '(?:(?:denn|eigentlich|noch ?mal|nochmals|wieder|noch|auch|ueberhaupt|jetzt|nun|das|unser|naechste|naechstes|naechsten|heute|morgen)\\s+)*';
  const tail = '(?:\\s+(?:denn|eigentlich|noch ?mal|wieder|heute|morgen))*';
  const patterns = [
    `^wann ist ${filler}training${tail}$`,
    `^wann findet ${filler}training${tail} statt$`,
    `^wann haben wir ${filler}training${tail}$`,
    '^wann trainieren wir(?: (?:denn|eigentlich|noch ?mal|wieder|heute|morgen|naechstes))*$',
    `^${filler}training${tail} (?:ist )?wann$`,
    `^ist ${filler}training${tail}$`,
    `^haben wir ${filler}training${tail}$`,
    `^gibt es ${filler}training${tail}$`,
    `^haben wir ${filler}training${tail} oder faellt es aus$`,
    `^findet ${filler}training${tail} (?:statt|statt oder faellt es aus)$`,
    `^faellt ${filler}training${tail} aus$`,
    `^ist ${filler}training${tail} (?:abgesagt|ausgefallen)(?: worden)?$`,
  ];
  const shorthand =
    /^(?:(?:heute|morgen) training|training (?:heute|morgen)|(?:wann ist )?das naechste training|naechstes training)$/;
  if (!patterns.some((pattern) => new RegExp(pattern).test(text)) && !shorthand.test(text))
    return null;
  const day = /\bheute\b/.test(text) ? 'today' : /\bmorgen\b/.test(text) ? 'tomorrow' : undefined;
  return {
    day,
    next: !day && /\b(?:naechst\w*|wieder)\b/.test(text),
    cancellation: /\b(?:aus|abgesagt|ausgefallen)\b/.test(text),
  };
}

function describe(t: QuestionTraining, showGroup: boolean): string {
  return `${showGroup ? `${t.group_name}:\n` : ''}${trainingDescription(t)}`;
}

export async function answerSchedule(ctx: BotContext): Promise<string | null> {
  const question = scheduleQuestion(ctx.text, ctx.isGroup);
  if (!question) return null;
  const rows = await loadQuestionTrainings(ctx, { day: question.day, next: question.next });
  const dayLabel = question.day === 'today' ? 'Heute' : question.day === 'tomorrow' ? 'Morgen' : '';
  if (!rows.length) {
    return dayLabel
      ? `${dayLabel} ist kein weiterer Trainingstermin im Plan eingetragen.`
      : 'Im Trainingsplan ist aktuell kein weiterer Termin eingetragen.';
  }
  const showGroup = !ctx.isGroup && new Set(rows.map((t) => t.group_jid)).size > 1;
  if (question.day) {
    const shown = rows.slice(0, 3);
    return (
      shown
        .map(
          (t) =>
            `${t.status === 'cancelled' ? `❌ ${dayLabel} abgesagt` : t.start_at <= ctx.now ? '🏓 Training läuft gerade' : `🏓 ${dayLabel} ist Training`}\n${describe(t, showGroup)}`,
        )
        .join('\n\n') +
      (rows.length > shown.length
        ? `\n\n${rows.length - shown.length} weitere Termine sind für diesen Tag eingetragen.`
        : '')
    );
  }
  // In private chats answer once per own group, rather than silently choosing another group's date.
  const groups = new Map<string, QuestionTraining[]>();
  for (const t of rows) groups.set(t.group_jid, [...(groups.get(t.group_jid) ?? []), t]);
  const sections: string[] = [];
  for (const trainings of [...groups.values()].slice(0, 3)) {
    const nearest = trainings[0];
    const active = trainings.find((t) => t.status === 'scheduled');
    const parts: string[] = [];
    if (nearest.status === 'cancelled' && (question.cancellation || !active)) {
      parts.push(`❌ Training abgesagt\n${describe(nearest, showGroup)}`);
    }
    if (active) {
      const title = active.start_at <= ctx.now ? 'Training läuft gerade' : 'Nächstes Training';
      parts.push(`🏓 ${title}\n${describe(active, showGroup)}`);
    } else {
      parts.push('Ein weiterer Trainingstermin ist noch nicht eingetragen.');
    }
    sections.push(parts.join('\n\n'));
  }
  if (groups.size > 3)
    sections.push(
      `Für ${groups.size - 3} weitere Gruppen sind Termine eingetragen. Frage am besten direkt in der jeweiligen Gruppe.`,
    );
  return sections.join('\n\n');
}
