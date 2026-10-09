/** Bounded German intent rules. Never interpret a person's name as the sender. */
export function normalizeLanguage(input: string): string {
  return input
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\b(?:spetter|spaetter|spater|speter)\b/g, 'spaeter')
    .replace(/\b(?:zusp[aä]et|zusp[aä]t)\b/g, 'zu spaet')
    .replace(/\b(?:verspahtung|verspatung|verspeetung)\b/g, 'verspaetung')
    .replace(/\b(?:puenktich|punktlich|puenktlch)\b/g, 'puenktlich')
    .replace(/\b(?:trainig|traning|trainign)\b/g, 'training')
    .replace(/\b(?:nich|net|ned|nit)\b/g, 'nicht')
    .replace(/\b(?:vllt|vlt|evtl)\b/g, 'vielleicht')
    .replace(/\b(?:bischen|bissl|bisl|bissel|bisschen)\b/g, 'etwas')
    .replace(/\b(?:kom|komm|kome|kommm?e)\b/g, 'komme')
    .replace(/\b(?:schaff|schaf)\b/g, 'schaffe')
    .replace(/\bverspaet\b/g, 'verspaete')
    .replace(/\b(?:hab|habs)\b/g, 'habe')
    .replace(/\b(?:binne|binn)\b/g, 'bin')
    .replace(/\s+/g, ' ')
    .trim();
}

export type AttendanceIntent = {
  kind: 'yes' | 'no' | 'late' | 'punctual' | 'uncertain' | 'none';
  minutes?: number;
  arrivalTime?: string;
  day?: 'today' | 'tomorrow';
  reference?: string;
};
export function attendanceIntent(input: string): AttendanceIntent {
  return parseAttendance(input, true);
}

// These are discourse markers, never a response on their own. In particular,
// bare "ja", "nein" and "doch" must not answer an unrelated group conversation.
function stripCorrection(text: string): string {
  return text.replace(
    /^(?:(?:bzw\.?|beziehungsweise|korrektur|plan(?:aenderung|wechsel)|ach\s+so|achso|ach|also|moment|halt|nee|nein|sorry|sry|doch|hi|hallo|hey|moin)\b[\s,.!:–-]*)+/,
    '',
  );
}

function shortReport(text: string, elliptical = false): string {
  const value = stripCorrection(text).replace(/^(?:nur|allerdings|leider)\s+/, '');
  if (
    /^(?:ich\s+)?(?:bin\s+(?:(?:heute|morgen|doch|wieder)\s+)*(?:am start|mit von der partie)|schaffe\s+(?:es|das)\s+(?:(?:heute|morgen)\s+)?doch)[.!]*$/.test(
      value,
    )
  )
    return `ich komme${/\bmorgen\b/.test(value) ? ' morgen' : /\bheute\b/.test(value) ? ' heute' : ''}`;
  if (
    /^(?:bei mir\s+)?wird\s+(?:es\s+)?(?:(?:heute|morgen|doch|leider)\s+)*(?:nichts|nix)[.!]*$/.test(
      value,
    )
  )
    return `ich komme${/\bmorgen\b/.test(value) ? ' morgen' : /\bheute\b/.test(value) ? ' heute' : ''} nicht`;
  if (/^(?:(?:heute|morgen)\s+)?(?:doch\s+|wieder\s+)?(?:mit\s+)?dabei[.!]*$/.test(value))
    return `ich bin ${value}`;
  if (
    (elliptical || value !== text) &&
    /^(?:doch\s+)?(?:nicht|gar nicht|nicht mehr|nicht dabei)[.!]*$/.test(value)
  )
    return `ich komme ${value.replace(/ dabei/, '')}`;
  if (elliptical && /^(?:etwas\s+)?(?:zu\s+)?spaet(?:er)?[.!]*$/.test(value))
    return `ich komme ${value}`;
  if (
    elliptical &&
    /^(?:erst\s+(?:gegen\s+|um\s+)?|gegen\s+)(?:[01]?\d|2[0-3])[:.][0-5]\d[.!]*$/.test(value)
  )
    return `ich komme ${value}`;
  // Subject omission is common in follow-ups. Restrict it to complete timing
  // reports; "5 Minuten" or "später" alone could answer any other question.
  if (
    /^(?:(?:heute|morgen|doch|wieder|etwas|ca\.?|ungefaehr)\s+)*(?:(?:[+-]?\d+(?:[.,-]\d+)?|[a-z]+)(?:\s+(?:bis|oder)\s+(?:\d+|[a-z]+))?\s*(?:min(?:uten?|s)?\.?|stunden?)\s+(?:zu\s+)?spaet(?:er)?|(?:eine?\s+)?(?:halbe|viertel|dreiviertel)\s*stunde\s+spaeter|(?:nicht mehr zu spaet|puenktlich))(?:\s+da)?[.!]*$/.test(
      value,
    )
  )
    return `ich bin ${value}`;
  return value;
}

type Clause = { text: string; correction: boolean; contrast: boolean };
function composedAttendance(text: string): AttendanceIntent | undefined {
  // Split only discourse boundaries, not dates, decimal values or time ranges.
  // At most eight clauses, no recursive composition and no conversation text
  // storage. The existing identity/session selection remains the authority.
  const boundary =
    /\s*\b(bzw\.?|beziehungsweise|korrektur|nee|nein|moment|aber|jedoch|allerdings|sondern|und)\b[\s,:.]*|[;,!.]\s*(?=(?:ich|komme|bin|werde|schaffe|kann|muss|doch|ach|bzw|korrektur|nee|moment)\b)/g;
  const clauses: Clause[] = [];
  let start = 0;
  let correction = false;
  let contrast = false;
  for (const match of text.matchAll(boundary)) {
    const part = text.slice(start, match.index).trim();
    if (part) clauses.push({ text: part, correction, contrast });
    correction = /^(?:bzw\.?|beziehungsweise|korrektur|nee|nein|moment)$/.test(match[1] ?? '');
    contrast = /^(?:aber|jedoch|allerdings)$/.test(match[1] ?? '');
    // "sondern" can negate an object, not the attendance. Leave its existing
    // conservative handling intact instead of discarding the negated object.
    if (match[1] === 'sondern') return undefined;
    start = match.index! + match[0].length;
  }
  if (!clauses.length) return undefined;
  clauses.push({ text: text.slice(start).trim(), correction, contrast });
  if (clauses.length > 8) return { kind: 'uncertain' };
  let combined: AttendanceIntent | undefined;
  let pendingCorrection = false;
  for (const clause of clauses) {
    const clean = shortReport(clause.text.replace(/[,;.!]+$/, ''), !!combined);
    if (!clean && /^(?:ach\b|doch\b|nee\b|moment\b)/.test(clause.text)) {
      pendingCorrection = true;
      continue;
    }
    const intent = parseAttendance(clean, false);
    if (intent.kind === 'uncertain') return intent;
    if (intent.kind === 'none') return { kind: 'none' };
    // A preceding work obligation explains lateness; it isn't an explicit
    // withdrawal when followed by an actual arrival statement.
    if (!combined && /^(?:ich\s+)?muss\s+(?:heute\s+|morgen\s+)?arbeiten[.!]*$/.test(clean))
      continue;
    const corrected =
      pendingCorrection ||
      clause.correction ||
      /^(?:ach\b|korrektur\b|moment\b|nee\b|bzw\b)/.test(clause.text) ||
      /\bdoch\b/.test(clause.text);
    pendingCorrection = false;
    if (!combined || corrected || (clause.contrast && intent.kind !== 'yes')) {
      // "komme, aber fünf Minuten später" refines rather than contradicts.
      combined = intent;
      continue;
    }
    if (combined.kind === intent.kind) {
      if (
        combined.kind === 'late' &&
        ((combined.minutes !== undefined &&
          intent.minutes !== undefined &&
          combined.minutes !== intent.minutes) ||
          (combined.arrivalTime &&
            intent.arrivalTime &&
            combined.arrivalTime !== intent.arrivalTime))
      )
        return { kind: 'uncertain' };
      combined = { ...combined, ...intent };
    } else if (combined.kind === 'yes' && ['late', 'punctual'].includes(intent.kind)) {
      combined = intent;
    } else if (intent.kind === 'yes' && ['late', 'punctual'].includes(combined.kind)) {
      // An additional attendance confirmation doesn't retract lateness.
    } else {
      return { kind: 'uncertain' };
    }
  }
  return pendingCorrection ? { kind: 'uncertain' } : combined;
}

const minuteWords: Record<string, number> = {
  eine: 1,
  einer: 1,
  eins: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fuenfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
  dreissig: 30,
  vierzig: 40,
  fuenfzig: 50,
  sechzig: 60,
};
for (const tens of ['zwanzig', 'dreissig', 'vierzig', 'fuenfzig'])
  for (const ones of ['ein', 'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben', 'acht', 'neun'])
    minuteWords[`${ones}und${tens}`] = minuteWords[ones] + minuteWords[tens];

function delayMinutes(text: string): number | undefined {
  // A range is useful as a lateness report, but not as one exact ETA. Likewise
  // "in 5 Minuten" measures from now, not from the start of training.
  if (
    /\d\s*(?:[-–,.]|bis|oder)\s*\d|(?:^|\s)[+-]\d|\b(?:bis|oder)\b|\bin\s+(?:(?:ca\.?|ungefaehr)\s+)?(?:\d|[a-z]+\s+(?:min|stunde))/.test(
      text,
    )
  )
    return undefined;
  const values: number[] = [];
  for (const match of text.matchAll(
    /\b(\d{1,3}|[a-z]+)\s*(min(?:uten|ute|s)?\.?|m|stunden?|std\.?)\b/g,
  )) {
    const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : minuteWords[match[1]];
    if (amount !== undefined) values.push(amount * (/^(?:stunde|std)/.test(match[2]) ? 60 : 1));
  }
  if (/\b(?:eine?\s+)?viertelstunde\b/.test(text)) values.push(15);
  if (/\b(?:eine?\s+)?dreiviertelstunde\b/.test(text)) values.push(45);
  if (/\bhalbe[n]?\s+stunde\b/.test(text)) values.push(30);
  // Multiple quantities require a correction clause, handled by the composer.
  const unique = [...new Set(values)];
  return unique.length === 1 && unique[0] > 0 && unique[0] <= 240 ? unique[0] : undefined;
}

function parseAttendance(input: string, compose: boolean): AttendanceIntent {
  const normalized = normalizeLanguage(input);
  const reference = /\(([a-zA-Z0-9_-]{1,64})\)\.?$/.exec(input.normalize('NFKC').trim())?.[1];
  const original = normalized.replace(/\([a-zA-Z0-9_-]{1,64}\)\.?$/, '').trim();
  const text = shortReport(original);
  const day = /\bmorgen\b/.test(original)
    ? 'tomorrow'
    : /\bheute\b/.test(original)
      ? 'today'
      : undefined;
  const result = (
    kind: AttendanceIntent['kind'],
    extras: Partial<AttendanceIntent> = {},
  ): AttendanceIntent => ({
    kind,
    ...(day ? { day } : {}),
    ...(reference ? { reference } : {}),
    ...extras,
  });
  if (!text || original.length > 600) return { kind: 'none' };
  // Only today/tomorrow are supported by the caller. Never silently resolve a
  // named weekday, calendar date or relative week to its next training window.
  if (
    /\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende|wochentags|januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|woche|monat|jahr|tagen?|uebermorgen|demnaechst)\b|\b(?:am|zum)\s+(?:\d|ersten|zweiten|dritten|morgen\b|(?:mo|di|mi|do|fr|sa|so)\b)|\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}\b/.test(
      text,
    )
  )
    return { kind: 'none' };
  if (/\bheute\b/.test(original) && /\bmorgen\b/.test(original)) return result('uncertain');
  if (/\b(?:aufgestanden|aufgewacht|gegessen|geschlafen|angekommen|gekommen)\b/.test(text))
    return { kind: 'none' };
  // Reports about yesterday, quotes, hypothetical conditions and questions cannot mutate attendance.
  if (
    /\b(?:gestern|vorgestern|letzte[nsr]?|damals|naechste\s+woche|uebermorgen)\b/.test(text) ||
    /["„“»«]/.test(text)
  )
    return { kind: 'none' };
  const self =
    /^(?:(?:hi|hallo|hey|moin|sorry|sry|leider|heute|morgen|doch|also|ok|okay|und|ja)\b[,!:. ]*)*(?:ich\s+(?:(?:heute|morgen|leider|doch)\s+)*)?(?:bin|komme|werde|schaffe|kann|habe|verspaete|stecke|stehe|sitze|haenge|falle|muss|brauche|melde|sage|fehle|nehme|mache)\b/.test(
      text,
    ) || /^(?:bei mir (?:wird|dauert)|wird bei mir)\b/.test(text);
  if (/\b(?:wir|uns|er|sie|du|ihr)\b/.test(text)) return { kind: 'none' };
  if (
    /\b(?:war|waren|hatte|hatten|kam|kamen|konnte|musste|wollte|sagt|sagte|meint|erzaehlt|gehoert|behauptet|gesagt|gefragt|gebeten|nachricht|mitteilung)\b/.test(
      text,
    )
  )
    return { kind: 'none' };
  if (
    /\b(?:kann|muss|will|moechte)\b.{0,20}\b(?:sagen|bestaetigen|berichten|fragen|wissen)\b|\bich\s+bin\s+(?:mir\s+)?sicher\b/.test(
      text,
    )
  )
    return { kind: 'none' };
  if (/\bich\s+(?:glaube|denke|hoere|sagte?|frage|meine)\b/.test(text)) return { kind: 'none' };
  const explicit =
    /^(?:bin\s+(?:heute\s+|morgen\s+)?dabei|dabei|sage\s+(?:heute\s+)?ab|muss\s+(?:heute\s+|morgen\s+)?absagen|(?:heute|morgen)\s+(?:leider\s+)?ohne\s+mich)[.! ]*$/.test(
      text,
    );
  const signal =
    /\b(?:spaet(?:er)?|verspaet\w*|puenktlich|training|dabei|absagen|stau|komme|schaffe|kann|bin)\b/.test(
      text,
    );
  if (
    signal &&
    (self || explicit || /\bich\b/.test(text)) &&
    (/\b(?:wenn|falls|vielleicht|eventuell|moeglicherweise|koennte|wuerde|wahrscheinlich|vermutlich|hoffentlich)\b/.test(
      text,
    ) ||
      text.includes('?'))
  )
    return result('uncertain');
  if (compose) {
    const composed = composedAttendance(text);
    if (composed) return result(composed.kind, composed);
  }
  if (!self && !explicit) return { kind: 'none' };
  if (
    /\b(?:melde\s+mich|schreibe|antworte|rufe)\b/.test(text) &&
    !/\b(?:komme|training|verspaetung)\b/.test(text)
  )
    return { kind: 'none' };
  // A training-specific object or short self-report is needed for ordinary positive/negative replies.
  // Do not turn "ich kann den Schlaeger nicht finden" into an absence.
  const training = /\b(?:training|tischtennis|tt|halle)\b/.test(text);
  if (
    !training &&
    /\b(?:essen|arbeit|schule|arzt|party|loesung|gedanken|idee|geburtstag|kino|konzert|bett|schlafen|aufstehen|termin|besprechung|buero|restaurant)\b/.test(
      text,
    )
  )
    return { kind: 'none' };
  const negative =
    /\b(?:nicht|kein[en]?|ohne|abgesagt|absagen|abmelden|fehle|verhindert|krank)\b/.test(text);
  if (
    /\bnicht\s+(?:(?:ca\.?|ungefaehr)\s+)?(?:\d+|[a-z]+)\s*(?:min(?:uten?|s)?|stunden?)\b|\bnicht\s+nicht\b/.test(
      text,
    )
  )
    return result('uncertain');
  if (
    /\b(?:nicht|keine[ns]?)\b.{0,35}\b(?:absagen|abmelden|abgesagt|ausfallen)\b|\b(?:sage|melde)\b.{0,35}\bnicht\b.{0,20}\bab\b|\b(?:nicht\s+frueher|nicht\s+mit\s+dem|nicht\s+mit\s+der|nicht\s+unpuenktlich|nicht\s+ohne)\b|\bkann\b.{0,20}\bnicht\s+(?:zu\s+)?spaeter\b/.test(
      text,
    )
  )
    return result('uncertain');
  if (/\bpuenktlich\b/.test(text) && /\boder\b/.test(text) && /\bspaet(?:er)?\b/.test(text))
    return result('uncertain');
  if (
    /\b(?:ich\s+)?sage\s+(?:(?:fuer|heute|morgen|leider|doch)\s+)*ab\b/.test(text) ||
    /\bkomme\b.*\bgar\s+nicht\b/.test(text)
  )
    return result('no');
  if (/\bsondern\b/.test(text)) return result('uncertain');
  if (
    /\b(?:bin\b.{0,25}\bnicht\s+(?:dabei|da)|habe\b.{0,25}\bkeine\s+zeit|falle\b.{0,25}\baus|komme\b.{0,20}\bauf\s+keinen\s+fall)\b|\bmuss\s+(?:heute\s+|morgen\s+)?arbeiten[.! ]*$/.test(
      text,
    )
  )
    return result('no');
  if (
    /\bnicht\s+nur\b|\bnicht\s+viel\b|\bnicht\s+sicher\b|\b(?:kaum|fast)\s+(?:zu\s+)?spaet/.test(
      text,
    )
  )
    return signal ? result('uncertain') : { kind: 'none' };
  if (
    /\b(?:nicht|nie|keinesfalls)\s+(?:mehr\s+)?(?:zu\s+)?spaet(?:er)?\b|\b(?:keine|ohne)\s+verspaetung\b|\bverspaete\s+mich\s+nicht\b/.test(
      text,
    )
  )
    return result('punctual');
  const missed =
    /\b(?:schaffe|kann)\b.{0,35}\bnicht\b/.test(text) &&
    (training ||
      /\b(?:schaffe\s+(?:(?:es|das|heute|morgen|leider|doch)\s+)*nicht|kann\s+(?:(?:heute|morgen|leider|doch)\s+)*nicht(?:\s+(?:kommen|dabei\s+sein|mitmachen))?)[.! ]*$/.test(
        text,
      ));
  const notOnTime = /\bnicht\s+(?:ganz\s+)?(?:puenktlich|rechtzeitig)\b/.test(text);
  if (/\b(?:werde|kann)\b.{0,25}\bnicht\s+(?:zum\s+training\s+)?kommen\b/.test(text))
    return result('no');
  if (
    /\bkomme\b.{0,35}\bnicht(?:\s+(?:mit|zum|ins|heute|morgen|mehr|leider|doch))?\b/.test(text) &&
    !notOnTime &&
    !/\b(?:zu|so)\s+spaet\b/.test(text)
  )
    return result('no');
  if (
    (missed && !notOnTime && !/\bpuenktlich\b/.test(text)) ||
    /\b(?:muss|moechte)\s+(?:(?:heute|morgen|leider|doch)\s+)*(?:absagen|mich\s+abmelden)\b/.test(
      text,
    ) ||
    /\bbin\s+(?:(?:heute|morgen|leider|doch)\s+)*(?:raus|verhindert|krank)\b/.test(text) ||
    /^(?:heute|morgen) (?:leider )?ohne mich[.! ]*$/.test(text) ||
    (training && /\b(?:sage\b.*\bab|fehle|falle\b.*\baus)\b/.test(text))
  )
    return result('no');
  if (/\bpuenktlich\b/.test(text) && !negative) return result('punctual');
  const clock = /\b(?:erst|gegen)\s+(?:um\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(text);
  const delayed =
    /\b(?:spaet(?:er)?|verspaet\w*)\b|\bnach\s+(?:trainingsbeginn|trainingsstart|beginn)\b/.test(
      text,
    ) || notOnTime;
  const transit =
    /\b(?:stecke|stehe|haenge|bin)\b.*\b(?:im\s+stau|stau)\b|\b(?:verpasse|verpasst)\b.*\bbus\b|\b(?:bus|zug|bahn)\b.*\bverspaetung\b/.test(
      text,
    );
  if (delayed || clock || transit) {
    if (
      !transit &&
      !/\b(?:komme|bin|werde|schaffe|verspaete|stecke|stehe|haenge)\b|^(?:bei mir|wird bei mir)\b|\bhabe\b.*\bverspaetung\b/.test(
        text,
      )
    )
      return { kind: 'none' };
    if (negative && !notOnTime) return result('uncertain');
    const minutes = delayMinutes(text);
    return result('late', {
      ...(minutes && minutes <= 240 ? { minutes } : {}),
      ...(clock ? { arrivalTime: `${clock[1].padStart(2, '0')}:${clock[2]}` } : {}),
    });
  }
  if (negative) return { kind: 'none' };
  if (
    /^(?:(?:heute|morgen)\s+)?(?:komme\s+ich|bin\s+ich\s+(?:mit\s+)?dabei)[.! ]*$|^(?:ich\s+)?sage\s+(?:heute\s+|morgen\s+)?zu[.! ]*$|^(?:ich\s+)?bin\s+(?:(?:heute|morgen)\s+)?mit\s+dabei[.! ]*$/.test(
      text,
    )
  )
    return result('yes');
  if (
    /^(?:ich\s+)?(?:nehme\s+(?:heute\s+|morgen\s+)?(?:am\s+training\s+)?teil|mache\s+(?:heute\s+|morgen\s+)?mit)[.! ]*$/.test(
      text,
    )
  )
    return result('yes');
  if (
    explicit ||
    /\b(?:bin|ich\s+bin)\s+(?:(?:heute|morgen|wieder|doch|auch|gerne|gern)\s+)*dabei\b/.test(
      text,
    ) ||
    /^(?:(?:hi|hallo|hey|moin|also|ok|okay|doch|ja)[,! ]+)*(?:ich\s+)?komme(?:\s+(?:heute|morgen|auch|doch|wieder|gerne|gern|mal|nun|jetzt|trotzdem|definitiv|mit|zum\s+training|ins\s+training|zum\s+tt|in\s+die\s+halle))*[.! ]*$/.test(
      text,
    )
  )
    return result('yes');
  return { kind: 'none' };
}

export type ChatIntent =
  | 'login'
  | 'stop'
  | 'reminders'
  | 'account'
  | 'privacy'
  | 'help'
  | 'schedule'
  | 'manage'
  | 'none';
export function chatIntent(input: string): ChatIntent {
  const t = normalizeLanguage(input)
    .replace(/[.!]+$/, '')
    .replace(/^(?:hallo|hey|hi|moin)[,! ]+/, '')
    .trim();
  if (
    /^kann\s+ich\s+mich\s+(?:anmelden|einloggen)\??$|^(?:schick|schicke|sende)\s+mir\s+(?:bitte\s+)?(?:einen?\s+)?(?:anmelde-?link|login-?link)(?:\s+bitte)?$/.test(
      t,
    )
  )
    return 'login';
  if (
    /^(?:bitte\s+)?(?:stopp?|keine\s+(?:persoenlichen\s+)?(?:nachrichten|erinnerungen)(?:\s+mehr)?)(?:\s+bitte)?$|^(?:ich\s+)?(?:will|moechte)\s+keine\s+(?:nachrichten|erinnerungen)(?:\s+mehr)?(?:\s+bitte)?$/.test(
      t,
    )
  )
    return 'stop';
  if (
    /^(?:(?:ich\s+)?(?:moechte|will|wuerde\s+gerne)\s+(?:mich\s+)?)?(?:anmelden|einloggen|login)(?:\s+bitte)?$|^(?:kannst\s+du\s+mir\s+)?(?:bitte\s+)?(?:einen?\s+)?(?:loginlink|anmeldelink)(?:\s+(?:schicken|senden))?\??$|^(?:trainerbereich|dashboard)\s+(?:oeffnen|anmelden)$/.test(
      t,
    )
  )
    return 'login';
  if (
    /^(?:stop|stopp|abmelden|keine\s+(?:persoenlichen\s+)?(?:nachrichten|erinnerungen)\s+mehr|(?:bitte\s+)?(?:erinnerungen|nachrichten)\s+(?:aus|stoppen|abschalten)|(?:bitte\s+)?(?:schreib|schreibe)\s+mir\s+nicht\s+mehr|(?:ich\s+)?(?:will|moechte)\s+keine\s+(?:nachrichten|erinnerungen)\s+mehr)$/.test(
      t,
    )
  )
    return 'stop';
  if (
    /^(?:erinnere\s+mich(?:\s+(?:bitte|ans\s+training|an\s+das\s+training))*|(?:persoenliche\s+)?erinnerungen(?:\s+(?:an|aktivieren|einschalten))?|(?:ich\s+)?(?:will|moechte)\s+(?:persoenliche\s+)?erinnerungen)$/.test(
      t,
    )
  )
    return 'reminders';
  if (
    /^(?:mein\s+)?(?:konto|profil|einstellungen|meine\s+daten)(?:\s+(?:oeffnen|ansehen|aendern|loeschen|exportieren))?$|^(?:konto|daten)\s+loeschen$/.test(
      t,
    )
  )
    return 'account';
  if (
    /^(?:datenschutz|datenschutzhinweise|privatsphaere|was\s+(?:weisst|speicherst)\s+du\s+(?:ueber|von)\s+mich\??)$/.test(
      t,
    )
  )
    return 'privacy';
  if (
    /^(?:hallo|hi|hey|moin|hilfe|help|was\s+kannst\s+du\??|wie\s+funktioniert\s+(?:das|tt)\??)$/.test(
      t,
    )
  )
    return 'help';
  if (
    /^(?:termine|wann\s+(?:ist|beginnt)\s+(?:das\s+|wieder\s+|naechstes?\s+)?training\??|findet\s+(?:heute\s+|morgen\s+)?training\s+statt\??)$/.test(
      t,
    )
  )
    return 'schedule';
  if (
    /\b(?:training|termin|serie|gruppe|datenschutz|trainer|erinnerung|bot)\b/.test(t) &&
    /\b(?:hinzufuegen|aendern|einladen|einstellen|verschieben|erstellen|absagen|verwalten|aktivieren|deaktivieren|pausieren)\b/.test(
      t,
    )
  )
    return 'manage';
  return 'none';
}
