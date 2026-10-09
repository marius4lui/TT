import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerSchedule } from '../apps/worker/src/questions/schedule';
import type { BotContext, Env } from '../apps/worker/src/types';
import { testDb } from './helpers/db';

const now = Date.parse('2026-10-09T18:00:00Z');
const group = '120363111111@g.us';
const other = '120363222222@g.us';
let db: ReturnType<typeof testDb>;
let env: Env;
beforeEach(async () => {
  db = testDb();
  await db.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'").run();
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: '',
    EVOLUTION_INSTANCE: '',
    EVOLUTION_API_KEY: '',
  };
  await db
    .prepare(
      "INSERT INTO users(id,jid,display_name,created_at) VALUES('member','491701234567@s.whatsapp.net','Marius',?)",
    )
    .bind(now)
    .run();
  for (const [jid, name] of [
    [group, 'Jugend'],
    [other, 'Erwachsene'],
  ]) {
    await db
      .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
      .bind(jid, name, now)
      .run();
  }
  await db
    .prepare("INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?)")
    .bind(group, now)
    .run();
});
afterEach(() => db.close());

function ctx(text: string, isGroup = true): BotContext {
  return {
    env,
    text,
    isGroup,
    chatJid: isGroup ? group : '491701234567@s.whatsapp.net',
    user: {
      id: 'member',
      jid: '491701234567@s.whatsapp.net',
      display_name: 'Marius',
      registered_at: null,
      reminders: 0,
      created_at: now,
    },
    eventId: 'question',
    timestamp: now,
    now,
    origin: 'https://tt.example',
  };
}
async function training(
  id: string,
  start: string,
  status = 'scheduled',
  jid = group,
  location = 'Sporthalle',
) {
  const startAt = Date.parse(start);
  await db
    .prepare(
      'INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      id,
      jid,
      start.slice(0, 10),
      startAt,
      startAt + 3_600_000,
      'Europe/Berlin',
      location,
      startAt - 86_400_000,
      startAt - 1_800_000,
      status,
      now,
    )
    .run();
}

describe('natural schedule questions', () => {
  it.each([
    'Armin wann ist noch mal Training',
    'Wann ist Training?',
    'Wann ist das nächste Training?',
    'Wann ist das nächste Mal Training?',
    'Wann ist nächstes Mal Training?',
    'Wann trainieren wir das nächste Mal?',
    'Wann trainieren wir nächstes Mal?',
    'Wann haben wir wieder Training?',
    'Wann findet das nächste Training statt?',
    'Wann trainieren wir wieder?',
    'Hey Armin, wann ist denn nochmal Training?',
    'Ist heute Training?',
    'Haben wir heute Training?',
    'Gibt es heute Training?',
    'Gibts heute Training?',
    "Gibt's heute Training?",
    'Haben wir heute Training oder fällt es aus?',
    'Ist heute noch Training?',
    'Ist heute überhaupt Training?',
    'Wann ist nochma Training?',
    'Wann ist TT?',
    'Findet heute Training statt?',
    'Training heute?',
    'Heute Training?',
    'Wann ist Tischtennistraining?',
    '/training',
    '/termine',
    'Termine',
  ])('answers clear schedule request: %s', async (text) => {
    await training('today-session', '2026-10-09T18:30:00Z');
    const result = await answerSchedule(ctx(text));
    expect(result).toContain('20:30');
    expect(result).toContain('Sporthalle');
    expect(result).not.toMatch(/today-session|https?:|\/login|Powered/);
  });

  it.each([
    'Bro warte Oke ja',
    'Ich komme heute nicht',
    'Training macht Spaß',
    'Heute ist Training',
    'Dann ist Training',
    'Da haben wir Training',
    'Bald findet Training statt',
    'Morgen ist Training',
    'Das ist Training',
    'Wann kommt Armin ins Training?',
    'Armin sagt, wann ist Training?',
    'Wenn heute Training ist komme ich',
    'Ist Training gut?',
    'Wann ist Fußballtraining?',
    'Wann ist Arbeit?',
    'Wann ist heute oder morgen Training?',
    'Wann ist am Montag Training?',
    'Wann ist am 12.10. Training?',
    'Wann war gestern Training?',
    'Wann ist nächste Woche Training?',
    '„Wann ist Training?“',
    '/training irgendwas',
    '/termine geheim',
    'Kann ich heute zum Training kommen?',
    'Soll ich heute zum Training kommen?',
    'Ist heute Training oder Fußball?',
    'Wo ist das Training?',
    'Wer kommt zum Training?',
  ])('remains silent outside supported question: %s', async (text) => {
    expect(await answerSchedule(ctx(text))).toBeNull();
  });

  it('preserves the private admin training command for the existing handler', async () => {
    expect(await answerSchedule(ctx('/training', false))).toBeNull();
  });

  it('uses current actual training times and distinguishes already running from explicit next', async () => {
    await training('current', '2026-10-09T17:30:00Z');
    await training('next', '2026-10-16T16:00:00Z', 'scheduled', group, 'Andere Halle');
    expect(await answerSchedule(ctx('Wann ist Training?'))).toContain('läuft gerade');
    const next = await answerSchedule(ctx('Wann ist das nächste Training?'));
    expect(next).toContain('16.10.');
    expect(next).toContain('Andere Halle');
    expect(next).not.toContain('läuft gerade');
  });

  it('never advertises a cancelled occurrence as the next training', async () => {
    await training('cancelled', '2026-10-09T18:30:00Z', 'cancelled');
    await training('next', '2026-10-16T16:00:00Z');
    const result = await answerSchedule(ctx('Wann ist das nächste Training?'));
    expect(result).toContain('16.10.');
    expect(result).not.toContain('09.10.');
  });

  it('answers explicit cancellation queries from stored status', async () => {
    await training('cancelled', '2026-10-09T18:30:00Z', 'cancelled');
    expect(await answerSchedule(ctx('Fällt heute Training aus?'))).toContain('Heute abgesagt');
    expect(await answerSchedule(ctx('Ist heute Training abgesagt?'))).toContain('Heute abgesagt');
  });

  it('answers no cancellation with actual scheduled occurrence, without speculating', async () => {
    await training('today', '2026-10-09T18:30:00Z');
    expect(await answerSchedule(ctx('Fällt heute Training aus?'))).toContain('Heute ist Training');
  });

  it('reports cancellation plus a following date for general cancellation query', async () => {
    await training('cancelled', '2026-10-09T18:30:00Z', 'cancelled');
    await training('next', '2026-10-16T16:00:00Z');
    const result = await answerSchedule(ctx('Fällt Training aus?'));
    expect(result).toContain('Training abgesagt');
    expect(result).toContain('Nächstes Training');
    expect(result).toContain('16.10.');
  });

  it('makes missing stored dates explicit, including a day whose training already ended', async () => {
    await training('ended', '2026-10-09T14:00:00Z');
    expect(await answerSchedule(ctx('Ist heute Training?'))).toBe(
      'Heute ist kein weiterer Trainingstermin im Plan eingetragen.',
    );
    expect(await answerSchedule(ctx('Ist morgen Training?'))).toBe(
      'Morgen ist kein weiterer Trainingstermin im Plan eingetragen.',
    );
    expect(await answerSchedule(ctx('Wann ist Training?'))).toContain(
      'kein weiterer Termin eingetragen',
    );
  });

  it('filters tomorrow using the training date, not the next arbitrary date', async () => {
    await training('today', '2026-10-09T18:30:00Z');
    await training('tomorrow', '2026-10-10T14:00:00Z');
    const result = await answerSchedule(ctx('Haben wir morgen Training?'));
    expect(result).toContain('10.10.');
    expect(result).not.toContain('09.10.');
  });

  it('never leaks another group in group or private answers', async () => {
    await training('secret', '2026-10-09T18:30:00Z', 'scheduled', other, 'Vertrauliche Halle');
    for (const isGroup of [true, false]) {
      const result = await answerSchedule(ctx('Wann ist Training?', isGroup));
      expect(result).not.toContain('Vertrauliche Halle');
      expect(result).toContain('kein weiterer');
    }
  });

  it('labels the next date per own group in private replies', async () => {
    await db
      .prepare(
        "INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?)",
      )
      .bind(other, now)
      .run();
    await training('first', '2026-10-09T18:30:00Z');
    await training('second', '2026-10-10T14:00:00Z', 'scheduled', other);
    const result = await answerSchedule(ctx('Wann ist das nächste Training?', false));
    expect(result).toContain('Jugend');
    expect(result).toContain('Erwachsene');
    expect(result).toContain('09.10.');
    expect(result).toContain('10.10.');
  });
});
