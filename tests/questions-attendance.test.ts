import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import type { BotContext, Env } from '../apps/worker/src/types';
import type { QuestionTraining } from '../apps/worker/src/questions/common';
import { answerOwnAttendance } from '../apps/worker/src/questions/attendance';
import { loadQuestionTrainings } from '../apps/worker/src/questions/common';

vi.mock('../apps/worker/src/questions/common', async (original) => ({
  ...(await original<typeof import('../apps/worker/src/questions/common')>()),
  loadQuestionTrainings: vi.fn(),
}));

let db: ReturnType<typeof testDb>;
let ctx: BotContext;
let training: QuestionTraining;
beforeEach(async () => {
  db = testDb();
  const now = Date.parse('2026-10-09T12:00:00Z');
  await db
    .prepare(
      "INSERT INTO users(id,jid,created_at) VALUES('me','me@s.whatsapp.net',?),('other','other@s.whatsapp.net',?)",
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO groups(jid,name,active,created_at) VALUES('group@g.us','Jugendtraining',1,?)",
    )
    .bind(now)
    .run();
  training = {
    id: 'session-secret-id',
    series_id: null,
    group_jid: 'group@g.us',
    group_name: 'Jugendtraining',
    local_date: '2026-10-09',
    start_at: Date.parse('2026-10-09T16:00:00Z'),
    end_at: Date.parse('2026-10-09T18:00:00Z'),
    timezone: 'Europe/Berlin',
    location: 'Sporthalle',
    invite_at: now,
    late_at: now,
    status: 'scheduled',
    version: 1,
    created_at: now,
  };
  await insertTraining(training);
  ctx = {
    env: { DB: db } as unknown as Env,
    user: {
      id: 'me',
      jid: 'me@s.whatsapp.net',
      display_name: 'Marius',
      created_at: now,
      registered_at: null,
      reminders: 0,
    },
    chatJid: 'group@g.us',
    isGroup: true,
    text: 'Bin ich angemeldet?',
    now,
    timestamp: now,
    eventId: 'question',
    origin: 'https://tt.invalid',
  };
  vi.mocked(loadQuestionTrainings).mockResolvedValue([training]);
});
afterEach(() => {
  db.close();
  vi.clearAllMocks();
});

async function insertTraining(t: QuestionTraining) {
  await db
    .prepare(
      'INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,status,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      t.id,
      t.group_jid,
      t.local_date,
      t.start_at,
      t.end_at,
      t.timezone,
      t.location,
      t.invite_at,
      t.late_at,
      t.status,
      t.version,
      t.created_at,
    )
    .run();
}
async function attendance(
  values: Partial<{
    user: string;
    session: string;
    response: string;
    punctuality: string;
    minutes: number;
    arrival: string;
    stale: number;
  }> = {},
) {
  await db
    .prepare(
      'INSERT INTO attendance(session_id,user_id,response,punctuality,minutes,arrival_time,needs_confirmation,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .bind(
      values.session ?? training.id,
      values.user ?? 'me',
      values.response ?? 'yes',
      values.punctuality ?? 'unknown',
      values.minutes ?? null,
      values.arrival ?? null,
      values.stale ?? 0,
      ctx.now,
    )
    .run();
}
async function ask(text: string) {
  return answerOwnAttendance({ ...ctx, text });
}

describe('own attendance questions', () => {
  it.each([
    'Bin ich angemeldet?',
    'Bin ich fürs Training angemeldet?',
    'Habe ich fürs Training zugesagt?',
    'Habe ich abgesagt?',
    'Wie bin ich eingetragen?',
    'Bin ich heute dabei?',
    'Bin ich noch abgemeldet?',
    'Habe ich mich angemeldet?',
    'Hab ich mich abgemeldet?',
    'Ist meine Zusage gespeichert?',
    'Wurde meine Absage eingetragen?',
    'Bin ich als verspätet gemeldet?',
    'Ist meine Verspätung gespeichert?',
    'Was ist mein Status fürs Training?',
    'Wie ist mein Trainingsstatus?',
    'Sag mal, bin ich eigentlich schon angemeldet?',
    'Bin ich mit dabei?',
    'Habe ich für heute zugesagt?',
    'Habe ich mich für morgen abgemeldet?',
  ])('answers clear first-person question: %s', async (text) => {
    expect(await ask(text)).toContain('noch nicht zugesagt oder abgesagt');
  });

  it.each([
    'Bin ich beim Newsletter angemeldet?',
    'Bin ich bei WhatsApp angemeldet?',
    'Bin ich beim Arzt angemeldet?',
    'Ist Philipp angemeldet?',
    'Hat er abgesagt?',
    'Wie viele sind angemeldet?',
    'Wer kommt?',
    'Ich bin angemeldet.',
    'Ich habe abgesagt.',
    'Bin ich krank?',
    'Was ist mein Status?',
    'Armin sagt: Bin ich angemeldet?',
    'Er fragte „Bin ich angemeldet?“',
    'Wenn ich angemeldet bin, komme ich.',
    'Bin ich heute oder morgen angemeldet?',
    'Bin ich nächsten Monat angemeldet?',
    'Bin ich gestern angemeldet?',
    'Habe ich abgesagt? Ich komme doch.',
    'Bin ich angemeldet und hat Philipp zugesagt?',
  ])('ignores unrelated, ambiguous or third-party question: %s', async (text) => {
    expect(await ask(text)).toBeNull();
    expect(loadQuestionTrainings).not.toHaveBeenCalled();
  });

  it.each([
    ['Bin ich heute angemeldet?', { day: 'today' }],
    ['Bin ich fürs heutige Training angemeldet?', { day: 'today' }],
    ['Habe ich morgen abgesagt?', { day: 'tomorrow' }],
    ['Habe ich fürs morgige Training zugesagt?', { day: 'tomorrow' }],
    ['Bin ich beim nächsten Training dabei?', { next: true }],
  ])('forwards explicit temporal scope: %s', async (text, scope) => {
    await ask(text as string);
    expect(loadQuestionTrainings).toHaveBeenCalledWith(
      expect.objectContaining({ user: ctx.user }),
      scope,
    );
  });

  it('reads own answer, not another member, without writing attendance or creating reminders', async () => {
    await attendance({ user: 'other', response: 'no' });
    await attendance({ punctuality: 'late', minutes: 5 });
    const before = await db.prepare('SELECT * FROM attendance ORDER BY user_id').all();
    const reply = await ask('Habe ich abgesagt?');
    expect(reply).toContain('Du hast zugesagt.');
    expect(reply).toContain('5 Minuten später');
    expect(reply).not.toMatch(/https?:|session-secret-id|other|abgesagt\./u);
    expect(await db.prepare('SELECT * FROM attendance ORDER BY user_id').all()).toEqual(before);
    expect(await db.prepare('SELECT SUM(reminders) AS count FROM users').first()).toEqual({
      count: 0,
    });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM outbox_jobs').first()).toEqual({
      count: 0,
    });
  });

  it('reports absence as absence, even with an old late marker', async () => {
    await attendance({ response: 'no', punctuality: 'late', minutes: 10 });
    const reply = await ask('Bin ich dabei?');
    expect(reply).toContain('Du hast abgesagt.');
    expect(reply).not.toContain('später');
  });
  it('reports arrival time and a stale response without implying confirmed attendance', async () => {
    await attendance({ punctuality: 'late', arrival: '18:15', stale: 1 });
    const reply = await ask('Wie bin ich eingetragen?');
    expect(reply).toContain('Bisher: Du hast zugesagt.');
    expect(reply).toContain('18:15 Uhr');
    expect(reply).toContain('Bitte bestätige deine Teilnahme erneut');
  });
  it('reports punctual attendance', async () => {
    await attendance({ punctuality: 'punctual' });
    expect(await ask('Wie bin ich eingetragen?')).toContain('als pünktlich eingetragen');
  });
  it('reports lateness without inventing minutes', async () => {
    await attendance({ punctuality: 'late' });
    const reply = await ask('Bin ich als verspätet gemeldet?');
    expect(reply).toContain('als verspätet eingetragen');
    expect(reply).not.toContain('Minuten');
  });
  it('cancellation takes precedence over an existing yes', async () => {
    await attendance();
    vi.mocked(loadQuestionTrainings).mockResolvedValue([{ ...training, status: 'cancelled' }]);
    const reply = await ask('Bin ich angemeldet?');
    expect(reply).toContain('fällt aus');
    expect(reply).not.toContain('Du hast zugesagt');
  });
  it('distinguishes missing training from an unknown attendance response', async () => {
    vi.mocked(loadQuestionTrainings).mockResolvedValue([]);
    expect(await ask('Bin ich morgen dabei?')).toContain(
      'Für morgen finde ich keinen Trainingstermin',
    );
  });
  it('labels multiple earliest-day entries rather than guessing a training', async () => {
    const later = {
      ...training,
      id: 'second',
      location: 'Nebenhalle',
      start_at: training.start_at + 3600000,
      end_at: training.end_at + 3600000,
    };
    await insertTraining(later);
    await attendance({ session: later.id, response: 'no' });
    const future = {
      ...training,
      id: 'future',
      local_date: '2026-10-16',
      start_at: training.start_at + 7 * 86400000,
    };
    vi.mocked(loadQuestionTrainings).mockResolvedValue([training, later, future]);
    const reply = await ask('Wie bin ich eingetragen?');
    expect(reply).toContain('Sporthalle');
    expect(reply).toContain('Nebenhalle');
    expect(reply).toContain('noch nicht zugesagt oder abgesagt');
    expect(reply).toContain('Du hast abgesagt');
    expect(reply).not.toContain('16.10.');
  });
  it('does not confuse a moved session original date with its current start date', async () => {
    const moved = {
      ...training,
      id: 'moved',
      location: 'Verlegte Halle',
      start_at: training.start_at + 7 * 86400000,
      end_at: training.end_at + 7 * 86400000,
    };
    vi.mocked(loadQuestionTrainings).mockResolvedValue([training, moved]);
    const reply = await ask('Bin ich dabei?');
    expect(reply).toContain('Sporthalle');
    expect(reply).not.toContain('Verlegte Halle');
    expect(reply).not.toContain('16.10.');
    expect(await db.prepare('SELECT COUNT(*) AS count FROM attendance').first()).toEqual({
      count: 0,
    });
  });
  it('labels two private-chat groups even when their time and venue are identical', async () => {
    const second = {
      ...training,
      id: 'other-group-session',
      group_jid: 'other@g.us',
      group_name: 'Erwachsene',
    };
    vi.mocked(loadQuestionTrainings).mockResolvedValue([training, second]);
    const reply = await answerOwnAttendance({
      ...ctx,
      text: 'Bin ich angemeldet?',
      isGroup: false,
    });
    expect(reply).toContain('Jugendtraining ·');
    expect(reply).toContain('Erwachsene ·');
  });
});
