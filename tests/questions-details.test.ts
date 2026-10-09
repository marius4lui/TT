import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerDetails } from '../apps/worker/src/questions/details';
import type { BotContext, Env } from '../apps/worker/src/types';
import { testDb } from './helpers/db';

const now = Date.parse('2026-10-09T15:00:00Z');
const group = '120363111111@g.us';
let db: ReturnType<typeof testDb>;
let context: BotContext;

async function session(
  id: string,
  date = '2026-10-09',
  options: { group?: string; status?: string; location?: string } = {},
) {
  const start = Date.parse(`${date}T16:00:00Z`);
  await db
    .prepare(
      'INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      id,
      options.group ?? group,
      date,
      start,
      start + 90 * 60_000,
      'Europe/Berlin',
      options.location ?? 'Sporthalle am Park',
      start - 86400_000,
      start - 1800_000,
      options.status ?? 'scheduled',
      now,
    )
    .run();
}

beforeEach(async () => {
  db = testDb();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'Jugendtraining', now)
    .run();
  await db
    .prepare(
      "INSERT INTO users(id,jid,display_name,created_at) VALUES('member','491701234568@s.whatsapp.net','Ada',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare("INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?)")
    .bind(group, now)
    .run();
  await session('today');
  context = {
    env: {
      DB: db,
      ASSETS: {} as Fetcher,
      EVOLUTION_URL: 'https://evolution.invalid',
      EVOLUTION_INSTANCE: 'test',
      EVOLUTION_API_KEY: 'fake',
    } satisfies Env,
    user: {
      id: 'member',
      jid: '491701234568@s.whatsapp.net',
      display_name: 'Ada',
      registered_at: null,
      reminders: 0,
      created_at: now,
    },
    chatJid: group,
    isGroup: true,
    text: '',
    eventId: 'question',
    timestamp: now,
    now,
    origin: 'https://tt.example',
  };
});
afterEach(() => db.close());
const answer = (text: string) => answerDetails({ ...context, text });

describe('natural training detail questions', () => {
  it.each([
    'Wo ist Training?',
    'Wo findet das Training statt?',
    'Wo ist heute das Training?',
    'In welcher Halle trainieren wir?',
    'In welcher Halle ist Tischtennistraining?',
    'An welchem Ort findet Training statt?',
    'Kannst du mir sagen, wo das Training ist?',
    'Hey, wo ist heute Training?',
    'Wo ist Trainig?',
    'Wo trainieren wir morgen?',
  ])('understands location: %s', async (text) => {
    await session('tomorrow', '2026-10-10');
    expect(await answer(text)).toContain('Sporthalle am Park');
  });

  it.each([
    ['Wann beginnt das Training?', '18:00'],
    ['Wann fängt Training an?', '18:00'],
    ['Wann startet das Training?', '18:00'],
    ['Wann geht Training los?', '18:00'],
    ['Um wie viel Uhr ist Training?', '18:00'],
    ['Zu welcher Uhrzeit ist Training?', '18:00'],
    ['Wann endet das Training?', '19:30'],
    ['Wann ist das Training vorbei?', '19:30'],
    ['Wann hört das Training auf?', '19:30'],
    ['Bis wann geht Training?', '19:30'],
    ['Bis um wieviel Uhr trainieren wir?', '19:30'],
    ['Wie lange geht das Training?', 'Geplante Dauer: 90 Minuten'],
    ['Wie lange trainieren wir heute?', 'Geplante Dauer: 90 Minuten'],
    ['Wie viele Minuten dauert Training?', 'Geplante Dauer: 90 Minuten'],
  ])('answers time detail: %s', async (text, expected) => {
    expect(await answer(text)).toContain(expected);
  });

  it.each([
    'Wann ist Training?',
    'Wann ist das nächste Training?',
    'Wo bist du?',
    'Wo ist meine Tasche?',
    'Wo war das Training gestern?',
    'Wenn wir Training hätten, wo wäre das?',
    'Armin sagte: „Wo ist Training?“',
    'Ich weiß, wo Training ist.',
    'Wo ist das Essen nach dem Training?',
    'Um wie viel Uhr muss ich zum Training fahren?',
    'Wo ist der Schlüssel fürs Training?',
    'Wie lange dauert das Aufwärmen beim Training?',
    'Wo finde ich einen Partner fürs Training?',
    'Wann kommt Max zum Training?',
    'Wie lange braucht der Bus zum Training?',
    'Wie lange dauert Training vielleicht?',
    'Wann beginnt nicht das Training?',
    'Wo ist nächste Woche Training?',
    'Wo ist am Montag Training?',
    'Wo ist Training heute oder morgen?',
    'Bro warte Oke ja',
  ])('stays silent for unsupported or unrelated messages: %s', async (text) => {
    expect(await answer(text)).toBeNull();
  });

  it('uses tomorrow rather than today', async () => {
    await session('tomorrow', '2026-10-10', { location: 'Andere Halle' });
    const response = await answer('Wo ist morgen Training?');
    expect(response).toContain('Andere Halle');
    expect(response).not.toContain('Sporthalle am Park');
  });

  it('answers ongoing training details but next explicitly skips the running session', async () => {
    context.now = Date.parse('2026-10-09T16:30:00Z');
    await session('tomorrow', '2026-10-10', { location: 'Morgenhalle' });
    expect(await answer('Wo ist Training?')).toContain('Sporthalle am Park');
    expect(await answer('Wo ist das nächste Training?')).toContain('Morgenhalle');
  });

  it('uses the training timezone for tomorrow across the UTC date boundary', async () => {
    context.now = Date.parse('2026-10-08T22:30:00Z');
    await session('tomorrow', '2026-10-10', { location: 'Samstagshalle' });
    expect(await answer('Wo ist morgen Training?')).toContain('Samstagshalle');
  });

  it('bounds answers to three entries and says when more sessions exist', async () => {
    for (let index = 0; index < 4; index++) await session(`additional-${index}`);
    const response = await answer('Wie lange dauert Training heute?');
    expect(response?.match(/Geplante Dauer/g)).toHaveLength(3);
    expect(response).toContain('Es gibt weitere Termine');
  });

  it('does not report a cancelled session as taking place', async () => {
    await db.prepare("UPDATE training_sessions SET status='cancelled' WHERE id='today'").run();
    const response = await answer('Wann endet Training heute?');
    expect(response).toContain('Abgesagt:');
    expect(response).not.toContain('Ende:');
  });

  it('reports a cancellation when all upcoming sessions were cancelled', async () => {
    await db.prepare("UPDATE training_sessions SET status='cancelled'").run();
    expect(await answer('Wo ist Training?')).toContain('Abgesagt:');
    expect(await answer('Wo ist Training?')).not.toContain('kein Training eingetragen');
  });

  it('gives each place and time once without repetitive labels', async () => {
    const response = await answer('Wo ist Training?');
    expect(response?.match(/Sporthalle am Park/g)).toHaveLength(1);
    expect(response?.match(/18:00/g)).toHaveLength(1);
    expect(response?.match(/19:30/g)).toHaveLength(1);
  });

  it('skips cancellation when asked for next scheduled location', async () => {
    await db.prepare("UPDATE training_sessions SET status='cancelled' WHERE id='today'").run();
    await session('tomorrow', '2026-10-10', { location: 'Andere Halle' });
    expect(await answer('Wo ist das nächste Training?')).toContain('Andere Halle');
  });

  it('says when the location has not been entered', async () => {
    await db.prepare("UPDATE training_sessions SET location='' WHERE id='today'").run();
    expect(await answer('Wo ist Training?')).toContain('noch nicht eingetragen');
  });

  it('does not pretend a past or unknown day has an upcoming session', async () => {
    expect(await answer('Bis wann geht Training morgen?')).toContain(
      'Für morgen ist kein weiteres Training eingetragen',
    );
    context.now = now + 4 * 3600_000;
    expect(await answer('Bis wann geht Training heute?')).toContain(
      'Für heute ist kein weiteres Training eingetragen',
    );
  });

  it('restricts answers to the active group and private memberships', async () => {
    const other = '120363222222@g.us';
    await db
      .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
      .bind(other, 'Andere Gruppe', now)
      .run();
    await session('other', '2026-10-09', { group: other, location: 'Geheimer Trainingsort' });
    expect(await answer('Wo ist Training?')).not.toContain('Geheimer');
    context.isGroup = false;
    context.chatJid = context.user.jid;
    expect(await answer('Wo ist Training?')).not.toContain('Geheimer');
    await db
      .prepare(
        "INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?)",
      )
      .bind(other, now)
      .run();
    const response = await answer('Wo ist Training?');
    expect(response).toContain('Andere Gruppe');
    expect(response).toContain('Jugendtraining');
  });

  it('answers read-only with no links, identifiers, attendance or consent writes', async () => {
    const response = await answer('Wie lange trainieren wir?');
    expect(response).not.toMatch(/https?:|120363|@g\.us|session|today/);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(0);
  });
});
