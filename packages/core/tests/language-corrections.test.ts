import { describe, expect, it } from 'vitest';
import { attendanceIntent } from '../src/language';

describe('deterministic self-corrections and clause composition', () => {
  it.each([
    ['Bzw ich komme doch aber ich bin 5 Minuten zu spät', 'late', 5],
    ['Bzw. ich komme doch, aber ich bin 5 Minuten zu spät.', 'late', 5],
    ['Beziehungsweise ich komme doch, aber bin fünf Minuten zu spät!', 'late', 5],
    ['Ach so, komme doch aber nur 5 min später', 'late', 5],
    ['Korrektur: Ich komme doch, allerdings zehn Minuten später', 'late', 10],
    ['Planänderung: Bin dabei, aber 15min später', 'late', 15],
    ['Sorry, komme doch und bin 5 min zu spät', 'late', 5],
    ['Ich komme doch. Ich bin fünf Minuten zu spät.', 'late', 5],
    ['Ich komme und ich verspäte mich um 5 Minuten', 'late', 5],
    ['Ich komme nicht. Ach doch, ich komme 5 Minuten später', 'late', 5],
    ['Ich komme nicht, aber ich komme doch 5 Minuten später', 'late', 5],
    ['Ich komme nicht, bzw. komme doch fünf Minuten später', 'late', 5],
    ['Ich bin 5 Minuten zu spät, aber ich komme', 'late', 5],
    ['Ich komme nicht pünktlich, aber ich bin 5 Minuten später da', 'late', 5],
    ['Ich komme später, bzw. ich bin 12 Minuten zu spät', 'late', 12],
    ['Ich komme 10 min später, Korrektur: 5 min später', 'late', 5],
    ['Bzw 5 Minuten später', 'late', 5],
    ['Doch dabei', 'yes', undefined],
    ['Bzw ich komme doch', 'yes', undefined],
    ['Achso, ich bin wieder dabei', 'yes', undefined],
    ['Ich schaffe es heute doch', 'yes', undefined],
    ['Bin heute am Start', 'yes', undefined],
    ['Ich komme, aber ich kann doch nicht', 'no', undefined],
    ['Ich komme. Ach nee, doch nicht', 'no', undefined],
    ['Korrektur: doch nicht dabei', 'no', undefined],
    ['Bzw komme heute doch net', 'no', undefined],
    ['Ich komme später. Doch ich muss absagen', 'no', undefined],
    ['Wird heute leider nix', 'no', undefined],
    ['Bei mir wird es heute nichts', 'no', undefined],
    ['Ich bin spät dran, aber ich komme doch pünktlich', 'punctual', undefined],
    ['Korrektur: doch pünktlich', 'punctual', undefined],
    ['Ich komme, aber nicht mehr zu spät', 'punctual', undefined],
    ['Bin dabei und ich bin pünktlich', 'punctual', undefined],
    ['Ich komme pünktlich, bzw. ich komme doch später', 'late', undefined],
    ['Ich komme, aber später', 'late', undefined],
    ['Ich komme und bin im Stau', 'late', undefined],
    ['Ich komme fünf Minuten nach Trainingsbeginn', 'late', 5],
    ['Ich verspät mich um 5 min', 'late', 5],
    ['Hab 7 Minuten Verspätung', 'late', 7],
    ['Ich komme nicht,komme doch', 'yes', undefined],
    ['Ich komme 5 min später nee 10 min später', 'late', 10],
    ['Ich komme 5 min später, Moment: ich komme pünktlich', 'punctual', undefined],
  ])('%s → %s (%s)', (text, kind, minutes) => {
    const actual = attendanceIntent(text as string);
    expect(actual.kind).toBe(kind);
    expect(actual.minutes).toBe(minutes);
  });

  it.each([
    'Ich komme nicht und ich komme',
    'Ich komme und ich komme nicht',
    'Ich komme pünktlich und ich komme 5 Minuten später',
    'Ich komme 10 min später und ich bin 20 min zu spät',
    'Bzw ich komme doch aber vielleicht 5 Minuten später',
    'Korrektur: Ich komme, falls ich es schaffe',
    'Ich komme doch, aber ich bin vermutlich 5 Minuten zu spät',
    'Bzw ich komme doch aber ich bin 5 Minuten zu spät?',
    'Ich komme heute nicht, aber morgen komme ich',
    'Ich komme nicht nur später, aber ich komme',
    'Ich komme nicht fünf Minuten später',
    'Ich komme nicht 5 min später',
    'Ich komme nicht nicht',
    'Ich komme. Ach doch.',
    'Bin heute morgen am Start',
    'Wird heute morgen nix',
    'Bzw ich komme doch aber ich bin 5 Minuten zu spät, wenn Paul kommt',
  ])('asks before changing an ambiguous report: %s', (text) => {
    expect(attendanceIntent(text).kind).toBe('uncertain');
  });

  it.each([
    'Bzw Paul kommt doch aber er ist 5 Minuten zu spät',
    'Ich komme und Paul kommt 5 Minuten später',
    'Korrektur: Er kommt doch',
    'Bzw ich glaube, Paul kommt später',
    'Ich komme, aber du kommst zu spät',
    'Bzw ich komme doch aber ich bin 5 Minuten zu spät, sagt Paul',
    'Korrektur: „Ich komme 5 Minuten später“',
    '"Bzw ich komme doch aber ich bin 5 Minuten zu spät"',
    'Bzw ich komme nächste Woche später',
    'Bzw ich bin gestern 5 Minuten zu spät gekommen',
    'Ich komme aber später zum Arzt',
    'Ich melde mich, aber später',
    'Ich komme und kaufe einen Schläger',
    'Bzw',
    'Doch',
    'Ach so',
    'Nein',
    'Ja',
    'nicht',
    '5 Minuten',
    'später',
  ])('does not treat other conversation as a self-report: %s', (text) => {
    expect(attendanceIntent(text).kind).toBe('none');
  });

  it.each([
    ['zwei Minuten', 2],
    ['drei Minuten', 3],
    ['sieben Minuten', 7],
    ['elf Minuten', 11],
    ['zwölf Minuten', 12],
    ['siebzehn Minuten', 17],
    ['einundzwanzig Minuten', 21],
    ['siebenundzwanzig Minuten', 27],
    ['fünfundfünfzig Minuten', 55],
    ['eine Minute', 1],
    ['1 Stunde', 60],
    ['zwei Stunden', 120],
    ['eine halbe Stunde', 30],
    ['eine Dreiviertelstunde', 45],
    ['ca. 7 min', 7],
    ['ungefähr 8 Minuten', 8],
    ['5-10 Minuten', undefined],
    ['sieben bis zwölf Minuten', undefined],
    ['1,5 Minuten', undefined],
    ['-5 Minuten', undefined],
    ['0 Minuten', undefined],
    ['500 Minuten', undefined],
    ['fünf Stunden', undefined],
  ])('extracts only an unambiguous duration: %s', (duration, minutes) => {
    expect(attendanceIntent(`Bzw ich komme doch aber ${duration} später`)).toMatchObject({
      kind: 'late',
    });
    expect(attendanceIntent(`Bzw ich komme doch aber ${duration} später`).minutes).toBe(minutes);
  });

  it('keeps the day/reference and distinguishes an arrival time from a duration', () => {
    expect(
      attendanceIntent('Bzw ich komme morgen doch aber bin 5 Minuten später da (AbC-123).'),
    ).toEqual({
      kind: 'late',
      minutes: 5,
      day: 'tomorrow',
      reference: 'AbC-123',
    });
    expect(attendanceIntent('Komme doch, aber erst gegen 18:20')).toEqual({
      kind: 'late',
      arrivalTime: '18:20',
    });
    expect(attendanceIntent('Ich komme später, bin in 5 Minuten da').minutes).toBeUndefined();
    expect(attendanceIntent('Ich komme in 5 Minuten später').minutes).toBeUndefined();
  });

  it('bounds work and declines malformed quantities', () => {
    expect(attendanceIntent('Bzw '.repeat(200) + 'ich komme').kind).toBe('none');
    expect(attendanceIntent(Array(10).fill('ich komme').join(' und ')).kind).toBe('uncertain');
    expect(attendanceIntent('Ich komme 99999 Minuten später').minutes).toBeUndefined();
  });
});
