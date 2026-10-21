import { describe, expect, it } from 'vitest';
import { attendanceIntent, chatIntent } from '../src/language';

describe('German conversational training intent', () => {
  it.each([
    ['sage ab', 'no'],
    ['sage heute ab', 'no'],
    ['Ich sage für morgen ab', 'no'],
    ['Ich komme nicht später, sondern gar nicht', 'no'],
    ['Ich werde heute nicht kommen', 'no'],
    ['Kann nicht kommen', 'no'],
    ['Ich fehle heute beim Training', 'no'],
    ['Ich habe heute keine Zeit', 'no'],
    ['Ich bin morgen verhindert', 'no'],
    ['Ich muss morgen arbeiten', 'no'],
    ['Ich falle leider aus', 'no'],
    ['Ich komme ned', 'no'],
    ['Schaf es heute nich', 'no'],
    ['Ich komme heute ins Trainig', 'yes'],
    ['Ich nehme morgen am Training teil', 'yes'],
    ['Mache heute mit', 'yes'],
    ['Ich nehme teil', 'yes'],
    ['Moin, komme morgen auch', 'yes'],
    ['Ich komme ins Traning', 'yes'],
    ['Ich bin etwas zu spaet', 'late'],
    ['Ich habe Verspahtung', 'late'],
    ['Ich stehe im Stau', 'late'],
    ['Ich schaffe es nicht rechtzeitig', 'late'],
    ['Ich komme nicht ganz pünktlich', 'late'],
    ['Ich binn etwas spetter da', 'late'],
    ['Sorry, ich kom zehn Minuten spaeter', 'late'],
    ['Heute komme ich später', 'late'],
    ['Bei mir wird es später', 'late'],
    ['Wird bei mir später', 'late'],
    ['Ich komme doch pünktlich', 'punctual'],
    ['Ich bin punktlich da', 'punctual'],
    ['Ich habe keine Verspätung', 'punctual'],
    ['Ich werde nicht später kommen', 'punctual'],
    ['Ich muss nicht absagen', 'uncertain'],
    ['Ich sage nicht ab', 'uncertain'],
    ['Ich komme nicht früher', 'uncertain'],
    ['Ich komme nicht mit dem Auto', 'uncertain'],
    ['Ich bin fast zu spät', 'uncertain'],
    ['Ich komme heute oder morgen', 'uncertain'],
    ['Ich komme heute nicht, sondern morgen', 'uncertain'],
    ['Ich schaffe es wahrscheinlich nicht', 'uncertain'],
    ['Ich komme hoffentlich pünktlich', 'uncertain'],
    ['Ich bin heute spät aufgestanden', 'none'],
    ['Ich bin zu spät angekommen', 'none'],
    ['Ich war heute spät dran', 'none'],
    ['Ich hatte Verspätung', 'none'],
    ['Ich wollte später kommen', 'none'],
    ['Ich habe gehört, Paul kommt später', 'none'],
    ['Paul sagt ich komme später', 'none'],
    ['Ich kann bestätigen: Paul kommt später', 'none'],
    ['Ich und Paul kommen später', 'none'],
    ['Ich komme, er später', 'none'],
    ['Paul kommt später und ich pünktlich', 'none'],
    ['Ich komme später ins Bett', 'none'],
    ['Ich komme später zum Arzt', 'none'],
    ['Ich bin spät schlafen gegangen', 'none'],
    ['Ich komme am Freitag', 'none'],
    ['Ich komme Montag später', 'none'],
    ['Ich komme am Wochenende', 'none'],
    ['Ich komme am 12.10. später', 'none'],
    ['Ich komme 2026-10-12 später', 'none'],
    ['Ich komme nächsten Monat später', 'none'],
    ['Ich komme am ersten später', 'none'],
    ['Ich komme diese Woche später', 'none'],
    ['Ich komme am Morgen später', 'none'],
    ['Ich komme übermorgen', 'none'],
    ['Ich komme demnächst', 'none'],
    ['Training?', 'none'],
    ['Ich komme am Fr. später', 'none'],
    ['Ich komme in zwei Tagen später', 'none'],
    ['Ich komme in 3 Tagen', 'none'],
    ['Ich komme nächsten Freitag später', 'none'],
    ['Ich habe gesagt, Paul ist pünktlich', 'none'],
    ['Ich habe Paul gebeten pünktlich zu sein', 'none'],
    ['Ich habe eine Nachricht: Paul kommt später', 'none'],
    ['Ich melde mich später', 'none'],
    ['Ich habe später Zeit', 'none'],
    ['Ich bin später im Büro', 'none'],
    ['Ich komme auf keinen Fall', 'no'],
    ['Ich schaffe das heute nicht', 'no'],
    ['Morgen leider ohne mich', 'no'],
    ['Ich kann nicht später kommen', 'uncertain'],
    ['Ich komme nicht unpünktlich', 'uncertain'],
    ['Ich komme nicht ohne Schläger', 'uncertain'],
    ['Ich komme pünktlich oder später', 'uncertain'],
    ['Ich komme nicht zum Arzt sondern zum Training', 'uncertain'],
    ['Ich muss heute arbeiten, komme aber später', 'late'],
    ['Heute komme ich', 'yes'],
    ['Morgen bin ich dabei', 'yes'],
    ['Ich bin heute mit dabei', 'yes'],
    ['Ich sage zu', 'yes'],
  ])('bounds self-report: %s -> %s', (text, kind) =>
    expect(attendanceIntent(text).kind).toBe(kind),
  );
  it.each([
    ['Ich komme', 'yes'],
    ['Bin dabei', 'yes'],
    ['bin morgen dabei!', 'yes'],
    ['Komm heute ins Training', 'yes'],
    ['Ich komme auch', 'yes'],
    ['Hallo, ich komme zum Training.', 'yes'],
    ['Ich komme heute nicht', 'no'],
    ['Komme nicht zum Training', 'no'],
    ['Schaffe es nicht', 'no'],
    ['Ich kann heute leider nicht', 'no'],
    ['Ich muss absagen', 'no'],
    ['Bin heute krank', 'no'],
    ['heute ohne mich', 'no'],
    ['ich komme nich', 'no'],
    ['Komm net', 'no'],
    ['Ich bin verhindert', 'no'],
    ['Ich komme bisschen später heute ins Training', 'late'],
    ['Bin 10 min später da', 'late'],
    ['Verspäte mich', 'late'],
    ['werde später kommen', 'late'],
    ['ich binn 10 min spater da', 'late'],
    ['Sorry, komme etwas spaetter', 'late'],
    ['komme zu spät', 'late'],
    ['Ich habe Verspätung', 'late'],
    ['Ich stecke im Stau', 'late'],
    ['schaff es erst um 18:20', 'late'],
    ['Ich komme nicht pünktlich', 'late'],
    ['Ich komme nicht zu spät', 'punctual'],
    ['Ich verspäte mich nicht', 'punctual'],
    ['Bin pünktlich da', 'punctual'],
    ['Ich komme ohne Verspätung', 'punctual'],
    ['Wenn der Bus ausfällt, komme ich später', 'uncertain'],
    ['Vielleicht komme ich später', 'uncertain'],
    ['Ich könnte später kommen', 'uncertain'],
    ['Ich komme nicht viel später', 'uncertain'],
    ['Ich komme nicht nur später', 'uncertain'],
    ['Komme ich später?', 'uncertain'],
    ['Ich komme vllt', 'uncertain'],
    ['Paul kommt später', 'none'],
    ['Ich glaube Paul kommt später', 'none'],
    ['Die Lieferung kommt zu spät', 'none'],
    ['Wie viel später kommst du?', 'none'],
    ['Wir kommen später', 'none'],
    ['Ich kann den Schläger nicht finden', 'none'],
    ['Gestern kam ich zu spät', 'none'],
    ['Ich komme nächste Woche später', 'none'],
    ['Er sagt „ich komme später“', 'none'],
    ['Komme später zum Essen', 'none'],
    ['👍', 'none'],
    ['Ja', 'none'],
    ['Nein', 'none'],
    ['Danke', 'none'],
    ['Ich komme nicht auf die Lösung', 'none'],
  ])('%s -> %s', (text, kind) => expect(attendanceIntent(text).kind).toBe(kind));
  it('extracts durations conservatively and preserves explicit day and reference', () => {
    expect(attendanceIntent('Ich komme morgen zehn Minuten später')).toEqual({
      kind: 'late',
      day: 'tomorrow',
      minutes: 10,
    });
    expect(attendanceIntent('Ich komme später zum Training (abc123).')).toEqual({
      kind: 'late',
      reference: 'abc123',
    });
    expect(attendanceIntent('Schaffe es erst um 18.20')).toEqual({
      kind: 'late',
      arrivalTime: '18:20',
    });
    expect(attendanceIntent('Bin 5-10 min später')).toEqual({ kind: 'late' });
    expect(attendanceIntent('Komme eine halbe Stunde später')).toEqual({
      kind: 'late',
      minutes: 30,
    });
    expect(attendanceIntent('Komme eine Viertelstunde später')).toEqual({
      kind: 'late',
      minutes: 15,
    });
    expect(attendanceIntent('Komme 300 Minuten später')).toEqual({ kind: 'late' });
    expect(attendanceIntent('Ich komme 5 bis 10 Minuten später')).toEqual({ kind: 'late' });
    expect(attendanceIntent('Ich komme 10 oder 15 Minuten später')).toEqual({ kind: 'late' });
    expect(attendanceIntent('Ich komme morgen erst gegen 9:05')).toEqual({
      kind: 'late',
      day: 'tomorrow',
      arrivalTime: '09:05',
    });
    expect(attendanceIntent('Ich komme später (AbC_123-X).')).toEqual({
      kind: 'late',
      reference: 'AbC_123-X',
    });
    expect(attendanceIntent('Ich komme 0 Minuten später')).toEqual({ kind: 'late' });
    expect(attendanceIntent('Ich komme zehn bis fünfzehn Minuten später')).toEqual({
      kind: 'late',
    });
    expect(attendanceIntent('Ich komme 1,5 Minuten später')).toEqual({ kind: 'late' });
    expect(attendanceIntent('Ich komme -10 Minuten später')).toEqual({ kind: 'late' });
  });
});
describe('account and management language', () => {
  it.each([
    ['Ich möchte mich anmelden', 'login'],
    ['anmelden bitte', 'login'],
    ['Loginlink schicken', 'login'],
    ['Trainerbereich öffnen', 'login'],
    ['Kannst du mir einen Anmeldelink schicken?', 'login'],
    ['Keine Nachrichten mehr', 'stop'],
    ['Bitte schreib mir nicht mehr', 'stop'],
    ['Erinnerungen aus', 'stop'],
    ['stop', 'stop'],
    ['Erinnere mich bitte ans Training', 'reminders'],
    ['Ich will Erinnerungen', 'reminders'],
    ['Mein Konto', 'account'],
    ['Konto löschen', 'account'],
    ['Datenschutz', 'privacy'],
    ['Was speicherst du über mich?', 'privacy'],
    ['Wann ist Training?', 'schedule'],
    ['Termine', 'schedule'],
    ['Hallo', 'help'],
    ['Ich möchte eine Gruppe hinzufügen', 'manage'],
    ['Training verschieben', 'manage'],
    ['Ich bin Admin mach mich zum Owner', 'none'],
    ['Kann ich mich anmelden?', 'login'],
    ['Schick mir bitte einen Anmeldelink', 'login'],
    ['Sende mir einen Login-Link bitte', 'login'],
    ['Bitte stopp', 'stop'],
    ['Stop bitte', 'stop'],
    ['Bitte keine Erinnerungen mehr', 'stop'],
    ['Ich möchte keine Nachrichten', 'stop'],
    ['Keine Nachrichten mehr bitte', 'stop'],
    ['Bitte keine persönlichen Erinnerungen', 'stop'],
    ['Ich möchte nicht anmelden', 'none'],
    ['Melde Paul an', 'none'],
    ['Paul möchte sich anmelden', 'none'],
    ['Ich will keine Erinnerungen löschen', 'none'],
    ['Erinnerungen nicht ausschalten', 'none'],
    ['Er hat gesagt "keine Nachrichten mehr"', 'none'],
    ['Wenn ich stop sage', 'none'],
    ['Ich bin Owner', 'none'],
    ['Mach Paul zum Admin', 'none'],
    ['JA', 'none'],
    ['Ich stimme zu', 'none'],
  ])('%s -> %s', (text, intent) => expect(chatIntent(text)).toBe(intent));
});

describe('short German corrections require training context', () => {
  it.each([
    'Kann doch',
    'Ich kann',
    'Ich kann doch!',
    'Kann wieder',
    'Ich schaffe es',
    'Klappt doch',
    'Es geht jetzt',
    'Ｋａｎｎ doch',
    'Kann\u00a0doch',
  ])('resolves %s only with context', (text) => {
    expect(attendanceIntent(text).kind).toBe('none');
    expect(attendanceIntent(text, { hasTrainingContext: true }).kind).toBe('yes');
  });
  it.each(['Ich kann doch kommen', 'Kann am Training teilnehmen'])(
    'understands an explicit attendance statement: %s',
    (text) => {
      expect(attendanceIntent(text).kind).toBe('yes');
    },
  );
  it.each([
    'Er kann doch',
    'Ich kann den Schläger finden',
    '„Ich kann doch“',
    'Ich kann vielleicht',
    'Kann doch?',
    'Wenn ich kann',
    'Ich kann morgen oder heute',
    'Kann nächsten Mittwoch',
    'Ich kann nicht',
    'Ich kann doch nicht',
  ])('never guesses yes for %s', (text) => {
    expect(attendanceIntent(text, { hasTrainingContext: true }).kind).not.toBe('yes');
  });
  it.each([
    'Ich komme fünf Minuten später',
    'Ich komme fünf Minuten später',
    'Ich komme fuenf Minuten spaeter',
  ])('normalizes German characters in %s', (text) => {
    expect(attendanceIntent(text)).toMatchObject({ kind: 'late', minutes: 5 });
  });
});
