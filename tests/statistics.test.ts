import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from './helpers/db';
import {
  answerStatistics,
  renderGroupStatistics,
  getGroupStatistics,
  parseStatisticsRequest,
  statisticsPeriods,
} from '../apps/worker/src/statistics';
import { processMessage } from '../apps/worker/src/bot';
import type { BotContext, Env } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, ctx: BotContext;
const now = Date.parse('2026-10-21T12:00:00Z');
const group = '120363111111@g.us';
beforeEach(async () => {
  db = testDb();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare("INSERT INTO groups(jid,name,active,created_at) VALUES(?,'Training',1,?)")
    .bind(group, now)
    .run();
  for (const id of ['self', 'a', 'b', 'trainer', 'bot', 'former']) {
    await db
      .prepare('INSERT INTO users(id,jid,display_name,created_at) VALUES(?,?,?,?)')
      .bind(id, id === 'self' ? '491701111111@s.whatsapp.net' : `${id}@s.whatsapp.net`, id, now)
      .run();
    await db
      .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,?,?)')
      .bind(group, id, id === 'former' ? 0 : 1, now)
      .run();
  }
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES('trainer','admin',?)")
    .bind(now)
    .run();
  await db.prepare("INSERT INTO identity_aliases(jid,user_id) VALUES('bot@lid','bot')").run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('bot_jid','bot@lid')").run();
  const user = {
    id: 'self',
    jid: '491701111111@s.whatsapp.net',
    display_name: 'self',
    registered_at: null,
    reminders: 0,
    created_at: now,
  };
  ctx = {
    env: { DB: db } as unknown as Env,
    user,
    isGroup: true,
    chatJid: group,
    text: 'Stats',
    eventId: 'stats',
    timestamp: now,
    now,
    origin: 'https://tt.example.org',
  };
});
afterEach(() => db.close());
async function session(
  id: string,
  start = now - 86400000,
  end = start + 3600000,
  status = 'scheduled',
) {
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,status,created_at) VALUES(?,?,'2000-01-01',?,?,'Europe/Berlin','Halle',?,?,?,?)",
    )
    .bind(id, group, start, end, start, start, status, now)
    .run();
}
async function signup(sessionId: string, userId: string, response = 'yes', needs = 0) {
  await db
    .prepare(
      'INSERT INTO attendance(session_id,user_id,response,needs_confirmation,updated_at) VALUES(?,?,?,?,?)',
    )
    .bind(sessionId, userId, response, needs, now)
    .run();
}
async function presence(sessionId: string, userId: string, state: string) {
  await db
    .prepare(
      'INSERT INTO session_presence(session_id,user_id,state,updated_at,confirmed_by) VALUES(?,?,?,?,?)',
    )
    .bind(sessionId, userId, state, now, 'trainer')
    .run();
}

describe('statistics parsing and calendar periods', () => {
  it('recognizes explicit aliases and rejects surrounding conversation', () => {
    for (const text of ['Stats', '/stats', 'Analysen', ' /STATS! ', '/Analysen'])
      expect(parseStatisticsRequest(text)?.months).toEqual([1, 6, 12]);
    expect(parseStatisticsRequest('/stats 6 monate')?.months).toEqual([6]);
    expect(parseStatisticsRequest('Statistik Jahr')?.months).toEqual([12]);
    expect(parseStatisticsRequest('/stats monat')?.months).toEqual([1]);
    expect(parseStatisticsRequest('/stats letzten Monat')?.months).toEqual([1]);
    expect(parseStatisticsRequest('Analysen letzte 6 Monate')?.months).toEqual([6]);
    for (const text of [
      'Er sagt Stats',
      'keine Stats',
      '"Stats"',
      'Stats wenn ich komme',
      '/stats 99 monate',
      'https://stats',
      'Stats\n/ja',
      'Analysen sind toll',
    ])
      expect(parseStatisticsRequest(text)).toBeNull();
  });
  it('subtracts calendar months in Berlin across DST and leap years', () => {
    const end = Date.parse('2024-03-31T10:00:00Z');
    const periods = statisticsPeriods(end, 'Europe/Berlin');
    expect(periods[0].from).toBe(Date.parse('2024-02-29T11:00:00Z'));
    expect(periods[1].from).toBe(Date.parse('2023-09-30T10:00:00Z'));
    expect(periods[2].until).toBe(end);
  });
});

describe('statistics ranking', () => {
  it('applies corrections, filters invalid sessions and people, and keeps shared ranks', async () => {
    await session('valid');
    for (const id of ['a', 'b', 'trainer', 'bot', 'former']) await signup('valid', id);
    await presence('valid', 'a', 'absent');
    await presence('valid', 'self', 'present');
    await session('second');
    await signup('second', 'a', 'yes', 1);
    await signup('second', 'b', 'no');
    await presence('second', 'b', 'automatic');
    await session('cancelled', now - 86400000, now - 1000, 'cancelled');
    await session('ongoing', now - 1000, now + 1000);
    await session('future', now + 1000, now + 2000);
    await session('old', now - 500 * 86400000);
    for (const id of ['cancelled', 'ongoing', 'future', 'old']) await signup(id, 'a');
    const rows = await getGroupStatistics(
      ctx,
      group,
      statisticsPeriods(now, 'Europe/Berlin', [1])[0],
    );
    expect(rows.map((r) => [r.userId, r.score, r.rank])).toEqual([
      ['b', 1, 1],
      ['self', 1, 1],
    ]);
    expect(rows.find((r) => r.userId === 'self')).toMatchObject({ signups: 0, confirmed: 1 });
  });
  it('includes exact lower boundary and ending now, ignores stale local_date', async () => {
    const period = statisticsPeriods(now, 'Europe/Berlin', [1])[0];
    await session('boundary', period.from, now);
    await signup('boundary', 'a');
    await session('before', period.from - 1, period.from + 1000);
    await signup('before', 'b');
    expect((await getGroupStatistics(ctx, group, period)).map((r) => r.userId)).toEqual(['a']);
  });
  it('enforces membership, group scope and privacy before returning data', async () => {
    await session('one');
    await signup('one', 'a');
    const period = statisticsPeriods(now, 'Europe/Berlin', [1])[0];
    expect(await getGroupStatistics({ ...ctx, chatJid: 'other@g.us' }, group, period)).toEqual([]);
    await db.prepare("UPDATE memberships SET active=0 WHERE user_id='self'").run();
    expect(await getGroupStatistics(ctx, group, period)).toEqual([]);
    expect((await answerStatistics(ctx))?.text).toContain('keine aktive');
    await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
    expect((await answerStatistics(ctx))?.text).toContain('nicht freigegeben');
  });
  it('requires a group choice in private and never combines groups', async () => {
    await db.prepare("INSERT INTO groups VALUES('other@g.us','Secret',1,?)").bind(now).run();
    await db.prepare("INSERT INTO memberships VALUES('other@g.us','self',1,?)").bind(now).run();
    expect((await answerStatistics({ ...ctx, isGroup: false }))?.text).toContain(
      'mehreren Trainingsgruppen',
    );
    expect((await answerStatistics(ctx))?.text).not.toContain('Secret');
  });
  it('excludes reserved practice groups from discovery, queries and rendering', async () => {
    const practice = '120363999999@g.us';
    await db.prepare("INSERT INTO groups VALUES(?,'Übung',1,?)").bind(practice, now).run();
    await db.prepare("INSERT INTO memberships VALUES(?,'self',1,?)").bind(practice, now).run();
    // Model an already-active group later reserved as practice; defense in depth
    // must exclude it even if malformed/imported data bypassed activation guards.
    await db
      .prepare(
        "INSERT INTO practice_groups(id,group_jid,subject,created_at) VALUES('practice',?,'Übung',?)",
      )
      .bind(practice, now)
      .run();
    await session('practice-training');
    await db
      .prepare('UPDATE training_sessions SET group_jid=? WHERE id=?')
      .bind(practice, 'practice-training')
      .run();
    await signup('practice-training', 'self');
    const answer = await answerStatistics({ ...ctx, isGroup: false });
    expect(answer?.groupJid).toBe(group);
    expect(answer?.text).not.toContain('mehreren');
    expect(
      await getGroupStatistics(
        { ...ctx, chatJid: practice },
        practice,
        statisticsPeriods(now, 'Europe/Berlin')[0],
      ),
    ).toEqual([]);
    expect(await renderGroupStatistics(db, practice, now)).toBe(
      'Statistiken sind nicht verfügbar.',
    );
    expect((await answerStatistics({ ...ctx, chatJid: practice }))?.groupJid).toBeUndefined();
  });
  it('labels partial history honestly and sanitizes output', async () => {
    await session('one');
    await signup('one', 'a');
    await db.prepare("UPDATE users SET display_name='*Name*\n_fake_\u202E' WHERE id='a'").run();
    await db
      .prepare(
        "INSERT INTO settings(key,value) VALUES('statistics_history_from',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .bind(String(now - 90 * 86400000))
      .run();
    const text = (await answerStatistics(ctx))?.text;
    expect(text).toContain('Nach Zusagen, mit Trainerkorrekturen');
    expect(text).toContain('nur teilweise erfasst');
    expect(text).toContain('Kein abschließendes Ergebnis');
    expect(text).toContain('1. Name fake: 1');
    expect(text).not.toContain('@s.whatsapp.net');
    expect(text?.match(/nur teilweise erfasst/g) || []).toHaveLength(2);
  });
  it('routes aliases once without changing responses or conversations', async () => {
    await session('one');
    await signup('one', 'a');
    await db
      .prepare("INSERT INTO conversations VALUES('self','training:wizard','{}',?)")
      .bind(now + 10000)
      .run();
    const event = {
      id: 'stats',
      chatJid: group,
      senderJid: ctx.user.jid,
      aliases: [],
      displayName: 'self',
      timestamp: now,
      isGroup: true,
      text: '/stats',
    };
    await processMessage(ctx.env, event, now);
    await processMessage(ctx.env, event, now);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first('n')).toBe(1);
    expect(await db.prepare('SELECT kind FROM conversations').first('kind')).toBe(
      'training:wizard',
    );
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first('n')).toBe(0);
  });
});
