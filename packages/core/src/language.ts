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
  const normalized = normalizeLanguage(input);
  const reference = /\(([a-zA-Z0-9_-]{1,64})\)\.?$/.exec(input.normalize('NFKC').trim())?.[1];
  const text = normalized.replace(/\([a-zA-Z0-9_-]{1,64}\)\.?$/, '').trim();
  const day = /\bmorgen\b/.test(text) ? 'tomorrow' : /\bheute\b/.test(text) ? 'today' : undefined;
  const result = (
    kind: AttendanceIntent['kind'],
    extras: Partial<AttendanceIntent> = {},
  ): AttendanceIntent => ({
    kind,
    ...(day ? { day } : {}),
    ...(reference ? { reference } : {}),
    ...extras,
  });
  if (!text || text.length > 600) return { kind: 'none' };
  // Only today/tomorrow are supported by the caller. Never silently resolve a
  // named weekday, calendar date or relative week to its next training window.
  if (
    /\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende|wochentags|januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|woche|monat|jahr|tagen?|uebermorgen|demnaechst)\b|\b(?:am|zum)\s+(?:\d|ersten|zweiten|dritten|morgen\b|(?:mo|di|mi|do|fr|sa|so)\b)|\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}\b/.test(
      text,
    )
  )
    return { kind: 'none' };
  if (/\bheute\b/.test(text) && /\bmorgen\b/.test(text)) return result('uncertain');
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
  const delayed = /\b(?:spaet(?:er)?|verspaet\w*)\b/.test(text) || notOnTime;
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
    const numeric = /\b(\d{1,3})\s*(?:min(?:uten|s)?\.?|m)\b/.exec(text);
    const words: Record<string, number> = {
      fuenf: 5,
      zehn: 10,
      fuenfzehn: 15,
      zwanzig: 20,
      fuenfundzwanzig: 25,
      dreissig: 30,
      vierzig: 40,
      fuenfundvierzig: 45,
      sechzig: 60,
    };
    const word =
      /\b(fuenf|zehn|fuenfzehn|zwanzig|fuenfundzwanzig|dreissig|vierzig|fuenfundvierzig|sechzig)\s+minuten?\b/.exec(
        text,
      );
    const minutes =
      /\d\s*(?:[-–,.]|bis|oder)\s*\d|(?:^|\s)[+-]\d|\b(?:fuenf|zehn|fuenfzehn|zwanzig|dreissig)\s+(?:bis|oder)\b/.test(
        text,
      )
        ? undefined
        : numeric
          ? Number(numeric[1])
          : word
            ? words[word[1]]
            : /\bviertel(?:stunde)?\b/.test(text)
              ? 15
              : /\bhalbe[n]?\s+stunde\b/.test(text)
                ? 30
                : undefined;
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
    /^(?:(?:hi|hallo|hey|moin|also|ok|okay|doch|ja)[,! ]+)*(?:ich\s+)?komme(?:\s+(?:heute|morgen|auch|doch|wieder|gerne|gern|mit|zum\s+training|ins\s+training|zum\s+tt|in\s+die\s+halle))*[.! ]*$/.test(
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
