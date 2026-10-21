import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { processMessage } from '../apps/worker/src/bot';
import { loadQuestionTrainings, questionText } from '../apps/worker/src/questions/common';
import type { BotContext, Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, user: User, ctx: BotContext;
const now = Date.parse('2026-10-09T18:00:00Z');
const group = '120363111111@g.us';
const other = '120363222222@g.us';
const foreign = '120363333333@g.us';
beforeEach(async () => {
  db = testDb();
  env = { DB: db } as unknown as Env;
  user = {
    id: 'self',
    jid: '491701111111@s.whatsapp.net',
    display_name: 'Sebastian',
    registered_at: null,
    reminders: 0,
    created_at: now,
  };
  await db
    .prepare('INSERT INTO users(id,jid,display_name,created_at) VALUES(?,?,?,?)')
    .bind(user.id, user.jid, user.display_name, now)
    .run();
  await db
    .prepare('INSERT INTO identity_aliases(jid,user_id) VALUES(?,?)')
    .bind(user.jid, user.id)
    .run();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  for (const [jid, name] of [
    [group, 'Training A'],
    [other, 'Training B'],
    [foreign, 'Fremde Gruppe'],
  ]) {
    await db
      .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
      .bind(jid, name, now)
      .run();
    if (jid !== foreign)
      await db
        .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
        .bind(jid, user.id, now)
        .run();
  }
  for (const [id, jid, start, place] of [
    ['current', group, now - 60000, 'Halle A'],
    ['next', group, now + 7 * 86400000, 'Halle A'],
    ['other', other, now + 60000, 'Halle B'],
    ['foreign', foreign, now + 1000, 'Geheime Halle'],
  ] as const)
    await db
      .prepare(
        "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES(?,?,'2026-10-09',?,?,'Europe/Berlin',?,?,?,?)",
      )
      .bind(id, jid, start, start + 3600000, place, now, now, now)
      .run();
  ctx = {
    env,
    user,
    chatJid: group,
    isGroup: true,
    text: '',
    eventId: '',
    timestamp: now,
    now,
    origin: 'https://tt.invalid',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected provider access');
    }),
  );
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});

async function ask(text: string, privateChat = false, id = crypto.randomUUID()) {
  await processMessage(
    env,
    {
      id,
      chatJid: privateChat ? user.jid : group,
      senderJid: user.jid,
      aliases: [user.jid],
      displayName: user.display_name,
      timestamp: now + 1000,
      isGroup: !privateChat,
      text,
    },
    now + 1000,
  );
  return (
    (await db
      .prepare('SELECT text FROM outbox_jobs WHERE dedupe_key=?')
      .bind(`reply:${id}:0`)
      .first<string>('text')) ?? ''
  );
}

describe('question scope and bot routing', () => {
  it('restricts group reads and private reads before selecting training', async () => {
    expect((await loadQuestionTrainings(ctx)).map((t) => t.id)).toEqual(['current', 'next']);
    expect((await loadQuestionTrainings({ ...ctx, isGroup: false })).map((t) => t.id)).toEqual([
      'current',
      'other',
      'next',
    ]);
    expect((await loadQuestionTrainings(ctx, { next: true })).map((t) => t.id)).toEqual(['next']);
    expect((await loadQuestionTrainings(ctx, { day: 'today' })).map((t) => t.id)).toEqual([
      'current',
    ]);
    await db.prepare('UPDATE memberships SET active=0 WHERE group_jid=?').bind(group).run();
    expect(await loadQuestionTrainings(ctx)).toEqual([]);
    await db.prepare('UPDATE groups SET active=0 WHERE jid=?').bind(other).run();
    expect(await loadQuestionTrainings({ ...ctx, isGroup: false })).toEqual([]);
  });
  it('requires privacy readiness for all information reads', async () => {
    await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    expect(await loadQuestionTrainings(ctx)).toEqual([]);
    expect(await loadQuestionTrainings({ ...ctx, isGroup: false })).toEqual([]);
    expect(await ask('Wann ist Training?')).toBe('');
  });
  it('uses the real moved instant and timezone instead of a stale local_date', async () => {
    await db
      .prepare("UPDATE training_sessions SET start_at=?,end_at=? WHERE id='next'")
      .bind(Date.parse('2026-10-09T22:30:00Z'), Date.parse('2026-10-09T23:30:00Z'))
      .run();
    expect((await loadQuestionTrainings(ctx, { day: 'tomorrow' })).map((t) => t.id)).toEqual([
      'next',
    ]);
  });
  it('answers the screenshot and next questions once, without IDs or links', async () => {
    const id = crypto.randomUUID();
    const first = await ask('Armin wann ist noch mal Training', false, id);
    expect(first).toContain('Halle A');
    expect(first).not.toMatch(/Halle B|Geheime|https?:|\bcurrent\b|\bnext\b/);
    await ask('Armin wann ist noch mal Training', false, id);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(1);
    expect(await ask('Wann ist nächstes Mal Training?')).toMatch(/16\.10|16\. Oktober/);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first('n')).toBe(0);
  });
  it('answers own status without registering, consenting or changing attendance', async () => {
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,punctuality,minutes,updated_at) VALUES('current',?,'yes','late',5,?)",
      )
      .bind(user.id, now)
      .run();
    const before = await db.prepare('SELECT * FROM attendance').all();
    const answer = await ask('Bin ich angemeldet?');
    expect(answer).toContain('Sebastian');
    expect(answer).toMatch(/5/);
    expect((await db.prepare('SELECT * FROM attendance').all()).results).toEqual(before.results);
    expect(
      await db
        .prepare('SELECT registered_at,reminders FROM users WHERE id=?')
        .bind(user.id)
        .first(),
    ).toEqual({ registered_at: null, reminders: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(0);
  });
  it('provides details without taking over the private legacy trainer wizard', async () => {
    expect(await ask('Wo ist Training?')).toContain('Halle A');
    expect(await ask('Wie lange dauert das Training?')).toMatch(/60|Stunde/);
    expect(await ask('/training')).toContain('Halle A');
    await db
      .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?)")
      .bind(user.id, now)
      .run();
    await db
      .prepare("INSERT INTO settings(key,value) VALUES('selected_group',?)")
      .bind(group)
      .run();
    await ask('/training', true);
    expect(
      await db
        .prepare('SELECT kind FROM conversations WHERE user_id=?')
        .bind(user.id)
        .first('kind'),
    ).toBe('training:wizard');
  });
  it.each([
    'Bro warte Oke ja',
    'Armin wie geht es dir?',
    'Paul fragt wann ist Training',
    '„Wann ist Training?“',
    'Wo wohnst du?',
    'Wie lange dauert der Film?',
  ])('ignores unrelated chatter: %s', async (text) => {
    expect(await ask(text)).toBe('');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first('n')).toBe(0);
  });
  it('keeps the existing attendance clarification for conditional participation, without changing attendance', async () => {
    expect(await ask('Wenn morgen Training ist komme ich')).toContain('Noch wurde nichts geändert');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first('n')).toBe(0);
  });
  it.each([
    'Wann ist Training am Freitag?',
    'Wann ist Training nächste Woche?',
    'Wann ist Training heute oder morgen?',
    'Wenn Training ist, wann beginnt es?',
    'Paul sagt: wann ist Training?',
  ])('rejects unsupported/quoted question scopes: %s', (text) => {
    expect(questionText(text)).toBeNull();
  });
});

describe('contextual short attendance replies in real training', () => {
  async function report(text: string, timestamp: number, quotedId?: string) {
    await processMessage(
      env,
      {
        id: crypto.randomUUID(),
        chatJid: group,
        senderJid: user.jid,
        aliases: [user.jid],
        displayName: user.display_name,
        timestamp,
        isGroup: true,
        text,
        ...(quotedId ? { quotedId } : {}),
      },
      timestamp,
    );
  }
  const response = () =>
    db
      .prepare("SELECT response FROM attendance WHERE session_id='current' AND user_id=?")
      .bind(user.id)
      .first('response');
  it('turns Kann doch and ich kann into a yes after an own decline', async () => {
    await report('Kann doch', now + 1000);
    expect(await response()).toBeNull();
    await report('Kann nicht', now + 2000);
    expect(await response()).toBe('no');
    await report('Kann doch', now + 3000);
    expect(await response()).toBe('yes');
    await report('Kann nicht', now + 4000);
    await report('ich kann', now + 5000);
    expect(await response()).toBe('yes');
  });
  it('never borrows context from unrelated quoted text or outdated training', async () => {
    await report('Kann nicht', now + 1000);
    await report('Kann doch', now + 2000, 'unrelated');
    expect(await response()).toBe('no');
    await db.prepare('UPDATE attendance SET needs_confirmation=1').run();
    await report('Kann doch', now + 3000);
    expect(await response()).toBe('no');
  });
  it('accepts a short reply to the current invitation without a prior answer', async () => {
    await db
      .prepare(
        "INSERT INTO messages(id,chat_jid,session_id,session_version,kind,created_at) VALUES('current-invite',?,'current',1,'invite',?)",
      )
      .bind(group, now)
      .run();
    await report('Ich kann', now + 1000, 'current-invite');
    expect(await response()).toBe('yes');
  });
});
