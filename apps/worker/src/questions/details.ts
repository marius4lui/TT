import type { BotContext } from '../types';
import {
  loadQuestionTrainings,
  questionText,
  trainingDescription,
  type QuestionTraining,
} from './common';

type Detail = 'location' | 'start' | 'end' | 'duration';

/** Only explicit questions about training facts; conversational statements stay silent. */
function detailQuestion(text: string): Detail | null {
  if (!/\b(?:training|trainieren|tischtennistraining|tt-training)\b/.test(text)) return null;
  // A question about another activity/person is not made relevant by mentioning training.
  if (
    /\b(?:arbeit|schule|spiel|turnier|essen|fussball|fussballtraining|abholen|holen|abfahrt|fahren|fahrt|ankommen|bus|zug)\b/.test(
      text,
    )
  )
    return null;
  if (/\b(?:nicht|kein|keine|vielleicht|oder|falls|wenn|wuerde|koennte)\b/.test(text)) return null;
  const value = text
    .replace(/^(?:(?:hi|hallo|hey|moin|bitte|kurze frage|frage|noch eine frage)[,!:]?\s+)+/, '')
    .replace(
      /^(?:kannst du (?:mir |uns )?(?:bitte )?sagen[, ]+|weisst du(?: noch)?[, ]+|weiss jemand[, ]+)/,
      '',
    );
  // The subject must remain the training itself, not e.g. its key, bus ride or
  // somebody's whereabouts. A bounded vocabulary makes this distinction explicit.
  const remainder = value
    .replace(
      /\b(?:wo|in|welcher|halle|an|welchem|ort|wann|um|wie|viel|viele|wieviel|uhr|zu|welcher|uhrzeit|bis|lange|minuten|stunden|ist|das|der|die|dem|den|ein|unser|unsere|unseres|naechste|naechsten|naechstes|naechstem|mal|naechstmal|noch|nochmal|heute|morgen|jetzt|diesmal|eigentlich|denn|genau|bitte|training|tischtennistraining|tt-training|trainieren|wir|findet|statt|beginnt|beginnen|startet|starten|faengt|an|anfangen|beginn|start|geht|los|endet|enden|vorbei|schluss|ende|aufhoeren|hoert|auf|dauert|haben|mit|dem|beim|am)\b/g,
      '',
    )
    .replace(/[\s,.?!:;-]/g, '');
  if (remainder) return null;
  if (
    !/^(?:wo\b|in welcher halle\b|an welchem ort\b|wann\b|um wie\s*viel uhr\b|zu welcher uhrzeit\b|bis wann\b|bis (?:um )?wie\s*viel uhr\b|wie lange\b|wie viele (?:minuten|stunden)\b)/.test(
      value,
    )
  )
    return null;
  if (/^(?:wo\b|in welcher halle\b|an welchem ort\b)/.test(value)) {
    return /\b(?:ist|findet|trainieren|training|tischtennistraining)\b/.test(value)
      ? 'location'
      : null;
  }
  if (/^(?:wie lange|wie viele (?:minuten|stunden))\b/.test(value)) return 'duration';
  if (
    /^(?:bis wann|bis (?:um )?wie\s*viel uhr)\b/.test(value) ||
    /\b(?:endet|enden|vorbei|schluss|ende|aufhoeren)\b/.test(value) ||
    /\bhoert\b.*\bauf\b/.test(value)
  )
    return 'end';
  if (
    /\b(?:beginnt|beginnen|startet|starten|anfangen|beginn|start|los)\b/.test(value) ||
    /\bfaengt\b.*\ban\b/.test(value) ||
    /^(?:um wie\s*viel uhr|zu welcher uhrzeit)\b/.test(value)
  )
    return 'start';
  return null;
}

function detail(t: QuestionTraining, kind: Detail): string {
  if (t.status === 'cancelled') return `Abgesagt: ${trainingDescription(t)}`;
  const description = trainingDescription(t).replace(/\s*·\s*$/, '');
  switch (kind) {
    case 'location':
      return t.location.trim()
        ? description
        : `${description}\nEin Trainingsort ist noch nicht eingetragen.`;
    case 'start':
    case 'end':
      return description;
    case 'duration': {
      const minutes = Math.round((t.end_at - t.start_at) / 60_000);
      return `${description}\nGeplante Dauer: ${minutes} Minuten`;
    }
  }
}

export async function answerDetails(ctx: BotContext): Promise<string | null> {
  const text = questionText(ctx.text);
  if (!text) return null;
  const kind = detailQuestion(text);
  if (!kind) return null;
  const day = /\bmorgen\b/.test(text) ? 'tomorrow' : /\bheute\b/.test(text) ? 'today' : undefined;
  const next = /\b(?:naechste\w*|naechstmal|naechstes mal)\b/.test(text);
  const trainings = await loadQuestionTrainings(ctx, { day, next });
  // An unqualified question refers to the nearest scheduled session in each group.
  // A day-specific question also reports cancellations rather than silently skipping them.
  const seenGroups = new Set<string>();
  const scheduledGroups = new Set(
    trainings
      .filter((training) => training.status === 'scheduled')
      .map((training) => training.group_jid),
  );
  const selected = trainings.filter((training) => {
    if (day) return true;
    if (
      (training.status === 'cancelled' && scheduledGroups.has(training.group_jid)) ||
      seenGroups.has(training.group_jid)
    )
      return false;
    seenGroups.add(training.group_jid);
    return true;
  });
  if (!selected.length) {
    const period = day === 'today' ? 'Für heute' : day === 'tomorrow' ? 'Für morgen' : 'Aktuell';
    return `${period} ist kein ${day ? 'weiteres ' : ''}Training eingetragen.`;
  }
  const multipleGroups = new Set(selected.map((training) => training.group_jid)).size > 1;
  const answers = selected.slice(0, 3).map((training) => {
    const heading = multipleGroups ? `${training.group_name || 'Trainingsgruppe'}\n` : '';
    return heading + detail(training, kind);
  });
  if (selected.length > 3)
    answers.push(
      'Es gibt weitere Termine. Frag bitte nach einem bestimmten Tag oder in der jeweiligen Trainingsgruppe.',
    );
  return answers.join('\n\n');
}
