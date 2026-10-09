import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import { processMessage } from '../apps/worker/src/bot';
import { resolveUser } from '../apps/worker/src/auth';
import { queue } from '../apps/worker/src/outbox';
import { materialize } from '../apps/worker/src/training';
import { localTimestamp, occurrence } from '@tt/core';
import type { MessageEvent } from '@tt/whatsapp';
import type { Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, clock: number, owner: User, member: User;
const group = '120363123456@g.us';
const times = occurrence({ weekday: 4, startTime: '18:00', endTime: '20:00' }, '2026-10-08');
beforeEach(async () => {
  db = testDb();
  clock = Date.parse('2026-10-08T12:00:00Z');
  env = {
    DB: db,
    ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } as unknown as Fetcher,
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'tt-test',
    EVOLUTION_API_KEY: 'test-only-secret',
  };
  owner = (await resolveUser(env, '491701234567@s.whatsapp.net', [], 'Trainer', clock))!;
  member = (await resolveUser(env, '491701234568@s.whatsapp.net', [], 'Mitglied', clock))!;
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?)")
    .bind(owner.id, clock)
    .run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', clock)
    .run();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('selected_group',?)").bind(group).run();
  for (const u of [owner, member])
    await db
      .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
      .bind(group, u.id, clock)
      .run();
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-08',?,?,'Europe/Berlin','Sporthalle',?,?,?)",
    )
    .bind(group, times.startAt, times.endAt, times.reminderAt, times.lateReminderAt, clock)
    .run();
  for (const [id, kind] of [
    ['invitation', 'invite'],
    ['late-prompt', 'late'],
  ])
    await db
      .prepare(
        'INSERT INTO messages(id,chat_jid,session_id,session_version,kind,created_at) VALUES(?,?,?,1,?,?)',
      )
      .bind(id, group, 'training', kind, clock)
      .run();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unmocked provider call');
    }),
  );
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function send(
  u: User,
  text: string,
  overrides: Partial<MessageEvent> = {},
): Promise<MessageEvent> {
  clock += 1000;
  const event: MessageEvent = {
    id: crypto.randomUUID(),
    chatJid: u.jid,
    senderJid: u.jid,
    aliases: [u.jid],
    displayName: u.display_name,
    timestamp: clock,
    isGroup: false,
    text,
    ...overrides,
  };
  await processMessage(env, event, clock);
  return event;
}
async function react(
  emoji: string,
  targetId = 'invitation',
  overrides: Partial<MessageEvent> = {},
) {
  return send(member, '', {
    isGroup: true,
    chatJid: group,
    reaction: { targetId, emoji },
    ...overrides,
  });
}
async function attendance() {
  return db
    .prepare('SELECT * FROM attendance WHERE session_id=? AND user_id=?')
    .bind('training', member.id)
    .first<{
      response: string;
      punctuality: string;
      minutes: number | null;
      arrival_time: string | null;
      needs_confirmation: number;
      updated_at: number;
    }>();
}
async function replyFor(event: MessageEvent): Promise<string> {
  return (
    (
      await db
        .prepare('SELECT text FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`reply:${event.id}:0`)
        .first<{ text: string }>()
    )?.text ?? ''
  );
}

describe('trainer dialogs and controlled activation', () => {
  it('rejects trainer commands without role and never starts trainer dialogs in a group', async () => {
    const denied = await send(member, '/training');
    expect(await replyFor(denied)).toContain('Berechtigung');
    await send(owner, '/training', { isGroup: true, chatJid: group });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM conversations').first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM training_series').first()).toEqual({ n: 0 });
  });
  it('requires selected provider group and configured privacy text before explicit activation', async () => {
    await db
      .prepare("UPDATE settings SET value='0' WHERE key IN ('enabled','privacy_ready')")
      .run();
    const blocked = await send(owner, '/aktivieren');
    expect(await replyFor(blocked)).toContain('/datenschutz');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM conversations').first()).toEqual({ n: 0 });
    await send(
      owner,
      '/datenschutz Verantwortlicher: TT Verein. Kontakt: Trainer. Wir verarbeiten Teilnahme zum Training.',
    );
    expect(
      await db.prepare("SELECT value FROM settings WHERE key='privacy_ready'").first(),
    ).toEqual({ value: '0' });
    await send(owner, '/bestätigen');
    expect(
      await db.prepare("SELECT value FROM settings WHERE key='privacy_ready'").first(),
    ).toEqual({ value: '1' });
    await send(owner, '/aktivieren');
    expect(await db.prepare("SELECT value FROM settings WHERE key='enabled'").first()).toEqual({
      value: '0',
    });
    await send(owner, '/bestätigen');
    expect(await db.prepare("SELECT value FROM settings WHERE key='enabled'").first()).toEqual({
      value: '1',
    });
  });
  it('allows only provider-returned groups and waits for selection confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([{ id: group, subject: 'TT', participants: [{ id: owner.jid }] }]),
          ),
      ),
    );
    const denied = await send(owner, '/gruppe 120363999999@g.us');
    expect(await replyFor(denied)).toContain('nicht zur Botinstanz');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM conversations').first()).toEqual({ n: 0 });
    await db.prepare("DELETE FROM settings WHERE key='selected_group'").run();
    await send(owner, `/gruppe ${group}`);
    expect(
      await db.prepare("SELECT value FROM settings WHERE key='selected_group'").first(),
    ).toBeNull();
    await send(owner, '/bestätigen');
    expect(
      await db.prepare("SELECT value FROM settings WHERE key='selected_group'").first(),
    ).toEqual({ value: group });
  });
  it('completes the six-step weekly wizard with a one-use confirmation', async () => {
    await send(owner, '/training');
    for (const answer of ['Donnerstag', '18:00', '20:00', 'Sporthalle', '18:00', '30'])
      await send(owner, answer);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM training_series').first()).toEqual({ n: 0 });
    const confirm = await send(owner, '/bestätigen');
    const series = await db
      .prepare('SELECT * FROM training_series')
      .first<{ id: string; weekday: number; start_time: string; end_time: string }>();
    expect(series).toMatchObject({ weekday: 4, start_time: '18:00', end_time: '20:00' });
    await processMessage(env, confirm, clock);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM training_series').first()).toEqual({ n: 1 });
    expect(
      (await db.prepare('SELECT * FROM training_sessions WHERE series_id=?').bind(series!.id).all())
        .results.length,
    ).toBe(7);
  });
  it('handles unavailable /gruppen without exposing provider details or rejecting the message', async () => {
    const event = await send(owner, '/gruppen');
    expect(await replyFor(event)).toContain('nicht erreichbar');
    expect(await replyFor(event)).not.toContain('test-only-secret');
  });
  it('rejects impossible calendar and ambiguous DST inputs before creating a confirmation', async () => {
    for (const command of [
      '/sondertraining 2026-11-31 18:00 20:00 Halle',
      '/sondertraining 2026-10-25 02:30 04:00 Halle',
    ]) {
      const event = await send(owner, command);
      expect(await replyFor(event)).toContain('ungültig');
      expect(await db.prepare('SELECT COUNT(*) AS n FROM conversations').first()).toEqual({ n: 0 });
    }
    expect(await db.prepare('SELECT COUNT(*) AS n FROM training_sessions').first()).toEqual({
      n: 1,
    });
  });
});

describe('participation and private/group provenance', () => {
  it('keeps participation when the dedicated lateness reaction is removed', async () => {
    await react('👍');
    await react('⏰', 'late-prompt');
    await react('', 'late-prompt');
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'punctual',
      minutes: null,
    });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(0);
  });
  it('supports the clock on combined invitations and a replacement thumbs-up clears its lateness', async () => {
    await react('⏰');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late' });
    await react('👍');
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'punctual',
      minutes: null,
    });
    await react('⏰');
    await send(member, '/spät training 20');
    await react('👍');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late', minutes: 20 });
  });
  it('does not clear separate lateness when replacing a combined invitation reaction', async () => {
    await react('⏰');
    await react('⏰', 'late-prompt');
    await react('👍');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late' });
    await send(member, '/nein training');
    await react('', 'late-prompt');
    expect(await attendance()).toMatchObject({ response: 'no', punctuality: 'punctual' });
  });
  it('supports reaction changes, private lateness and old reaction removal without losing the private answer', async () => {
    await react('👍🏽');
    expect((await attendance())?.response).toBe('yes');
    await react('👎');
    expect((await attendance())?.response).toBe('no');
    await send(member, '/spät training 10');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late', minutes: 10 });
    await react('');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late', minutes: 10 });
    await react('⏰', 'late-prompt');
    await send(member, '/spät training 20');
    await react('', 'late-prompt');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late', minutes: 20 });
    await send(member, '/nein training');
    expect(await attendance()).toMatchObject({
      response: 'no',
      punctuality: 'punctual',
      minutes: null,
    });
  });
  it('ignores unknown targets, unsupported emoji and direct emoji texts', async () => {
    await react('👍', 'unrelated-message');
    await react('❤️');
    await send(member, '👍', { isGroup: true, chatJid: group });
    expect(await attendance()).toBeNull();
    await react('👍');
    await react('');
    expect((await attendance())?.response).toBe('unknown');
  });
  it('deduplicates replayed reactions without spamming the group with acknowledgments', async () => {
    const event = await react('👍');
    const row = await attendance();
    await processMessage(env, event, clock + 1000);
    expect(await attendance()).toEqual(row);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`attendance:${event.id}`)
        .first(),
    ).toEqual({ n: 0 });
  });
  it('keeps reconfirmation required after same or stale response replay, then clears it for a newer real response', async () => {
    const original = await send(member, '/ja training');
    await db
      .prepare("UPDATE attendance SET needs_confirmation=1 WHERE session_id='training'")
      .run();
    await processMessage(env, original, clock + 1000);
    expect(await attendance()).toMatchObject({ response: 'yes', needs_confirmation: 1 });
    await send(member, '/nein training', { timestamp: original.timestamp - 1000 });
    expect(await attendance()).toMatchObject({ response: 'yes', needs_confirmation: 1 });
    await send(member, '/ja training');
    expect(await attendance()).toMatchObject({ response: 'yes', needs_confirmation: 0 });
  });
  it('requires private membership and ignores unconfigured group messages', async () => {
    await db.prepare('UPDATE memberships SET active=0 WHERE user_id=?').bind(member.id).run();
    const denied = await send(member, '/ja training');
    expect(await replyFor(denied)).toContain('kein bevorstehendes Training');
    expect(await attendance()).toBeNull();
    await react('👍', 'invitation', { chatJid: '120363999999@g.us' });
    expect(await attendance()).toBeNull();
  });
  it('accepts explicit private replies for another member group and asks when two training choices are plausible', async () => {
    const other = '120363999999@g.us';
    await db
      .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
      .bind(other, 'TT zweite Gruppe', clock)
      .run();
    await db
      .prepare('INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?)')
      .bind(other, member.id, clock)
      .run();
    await db
      .prepare(
        "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) SELECT 'other-training',?,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at FROM training_sessions WHERE id='training'",
      )
      .bind(other)
      .run();
    const ambiguous = await send(member, '/ja');
    expect(await replyFor(ambiguous)).toContain('Bitte wähle');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM attendance').first()).toEqual({ n: 0 });
    await send(member, '/ja other-training');
    expect(await db.prepare('SELECT session_id,response FROM attendance').first()).toEqual({
      session_id: 'other-training',
      response: 'yes',
    });
    expect(await attendance()).toBeNull();
  });
  it.each(['privacy_ready', 'enabled'])(
    'ignores group reactions when %s is revoked before processing',
    async (setting) => {
      await db.prepare('UPDATE settings SET value=? WHERE key=?').bind('0', setting).run();
      await react('👍');
      expect(await attendance()).toBeNull();
      expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first()).toEqual({ n: 0 });
    },
  );
  it('recognizes the screenshot sentence, declines third-party booking and asks for conditional certainty', async () => {
    await send(member, 'Paul kommt später', { isGroup: true, chatJid: group });
    expect(await attendance()).toBeNull();
    const uncertain = await send(member, 'Wenn der Bus ausfällt, komme ich später', {
      isGroup: true,
      chatJid: group,
    });
    expect(await replyFor(uncertain)).toContain('Bitte bestätige');
    expect(await attendance()).toBeNull();
    await send(member, 'Ich komme bisschen später heute ins Training', {
      isGroup: true,
      chatJid: group,
    });
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'late',
      minutes: null,
    });
    await send(member, 'Schaffe es erst um 18:20', { isGroup: true, chatJid: group });
    expect((await attendance())?.arrival_time).toBe('18:20');
  });
  it('preserves responses during a move, cancels old jobs and rejects stale message versions', async () => {
    await react('👍');
    await queue(
      db,
      {
        key: 'old-invite',
        chat: group,
        text: 'old',
        kind: 'invite',
        sessionId: 'training',
        version: 1,
      },
      clock,
    );
    await send(owner, '/verschieben training 2026-10-09 19:00');
    expect(
      await db.prepare("SELECT version FROM training_sessions WHERE id='training'").first(),
    ).toEqual({ version: 1 });
    await send(owner, '/bestätigen');
    expect(
      await db
        .prepare("SELECT id,version,start_at FROM training_sessions WHERE id='training'")
        .first(),
    ).toEqual({ id: 'training', version: 2, start_at: localTimestamp('2026-10-09', '19:00') });
    expect(await attendance()).toMatchObject({ response: 'yes', needs_confirmation: 1 });
    expect(
      await db.prepare("SELECT status FROM outbox_jobs WHERE dedupe_key='old-invite'").first(),
    ).toEqual({ status: 'cancelled' });
    const stale = await react('👎');
    expect(await replyFor(stale)).toContain('aktuelle Einladung');
    expect(await attendance()).toMatchObject({ response: 'yes', needs_confirmation: 1 });
  });
  it('cancels only after confirmation and enqueues current group/personal cancellation notices', async () => {
    await db
      .prepare('UPDATE users SET registered_at=?,reminders=1 WHERE id=?')
      .bind(clock, member.id)
      .run();
    await queue(
      db,
      {
        key: 'obsolete',
        chat: group,
        text: 'invite',
        kind: 'invite',
        sessionId: 'training',
        version: 1,
      },
      clock,
    );
    await send(owner, '/ausfall training');
    expect(
      await db.prepare("SELECT status FROM training_sessions WHERE id='training'").first(),
    ).toEqual({ status: 'scheduled' });
    await send(owner, '/bestätigen');
    expect(
      await db.prepare("SELECT status,version FROM training_sessions WHERE id='training'").first(),
    ).toEqual({ status: 'cancelled', version: 2 });
    expect(
      await db.prepare("SELECT status FROM outbox_jobs WHERE dedupe_key='obsolete'").first(),
    ).toEqual({ status: 'cancelled' });
    expect(
      (
        await db
          .prepare(
            "SELECT kind,session_version FROM outbox_jobs WHERE kind IN ('change','personal_change') ORDER BY kind",
          )
          .all()
      ).results,
    ).toEqual([
      { kind: 'change', session_version: 2 },
      { kind: 'personal_change', session_version: 2 },
    ]);
    const rejected = await send(member, '/ja training');
    expect(await replyFor(rejected)).toContain('abgesagt');
    expect(await attendance()).toBeNull();
  });
  it('records one-off and pause exceptions so recurring sessions remain cancelled after rematerialization', async () => {
    await db
      .prepare(
        "INSERT INTO training_series(id,group_jid,weekday,start_time,end_time,location,created_at) VALUES('weekly',?,4,'18:00','20:00','Sporthalle',?)",
      )
      .bind(group, clock)
      .run();
    await materialize(db, clock, true);
    await send(owner, '/ausfall weekly-2026-10-15');
    await send(owner, '/bestätigen');
    await send(owner, '/pause 2026-10-22 2026-10-29');
    await send(owner, '/bestätigen');
    expect(
      (
        await db
          .prepare('SELECT kind,from_date,to_date FROM training_exceptions ORDER BY from_date')
          .all()
      ).results,
    ).toEqual([
      { kind: 'cancel', from_date: '2026-10-15', to_date: '2026-10-15' },
      { kind: 'pause', from_date: '2026-10-22', to_date: '2026-10-29' },
    ]);
    await materialize(db, clock, true);
    expect(
      (
        await db
          .prepare(
            "SELECT local_date,status FROM training_sessions WHERE series_id='weekly' AND local_date BETWEEN '2026-10-15' AND '2026-10-29' ORDER BY local_date",
          )
          .all()
      ).results,
    ).toEqual([
      { local_date: '2026-10-15', status: 'cancelled' },
      { local_date: '2026-10-22', status: 'cancelled' },
      { local_date: '2026-10-29', status: 'cancelled' },
    ]);
    expect(
      await db.prepare("SELECT status FROM training_sessions WHERE id='weekly-2026-11-05'").first(),
    ).toEqual({ status: 'scheduled' });
  });
  it('rejects a staged edit when the training changed before confirmation', async () => {
    await send(owner, '/verschieben training 2026-10-09 19:00');
    await db.prepare("UPDATE training_sessions SET version=2 WHERE id='training'").run();
    const confirmed = await send(owner, '/bestätigen');
    expect(await replyFor(confirmed)).toContain('inzwischen geändert');
    expect(
      await db
        .prepare("SELECT start_at,version FROM training_sessions WHERE id='training'")
        .first(),
    ).toEqual({ start_at: times.startAt, version: 2 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM conversations').first()).toEqual({ n: 0 });
  });
});

describe('natural language and quiet web handoff', () => {
  it('applies the real absence → correction → late → punctual → absence conversation once per message', async () => {
    const inGroup = { isGroup: true, chatJid: group };
    await send(member, 'Ich komme heute mal net', inGroup);
    expect(await attendance()).toMatchObject({ response: 'no', minutes: null });
    const correction = await send(
      member,
      'Bzw ich komme doch aber ich bin 5 Minuten zu spät',
      inGroup,
    );
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late', minutes: 5 });
    const acknowledgment = await db
      .prepare('SELECT text FROM outbox_jobs WHERE dedupe_key=?')
      .bind(`attendance:${correction.id}`)
      .first<string>('text');
    expect(acknowledgment).toContain('5 Minuten später');
    expect(acknowledgment).not.toMatch(/https?:|\/login|\(training\)/);
    // Redelivery of the same provider event cannot repeat the confirmation.
    await processMessage(env, correction, clock);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(2);
    await send(member, 'Korrektur: doch pünktlich', inGroup);
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'punctual',
      minutes: null,
      arrival_time: null,
    });
    await send(member, 'Bzw ich komme doch nicht', inGroup);
    expect(await attendance()).toMatchObject({ response: 'no', minutes: null });
    await send(member, 'Ich komme doch pünktlich', inGroup);
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'punctual' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(5);
  });
  it('does not overwrite a newer correction with a delayed older statement or an ambiguous sentence', async () => {
    const earlier = clock;
    await send(member, 'Ich komme heute nicht');
    await send(member, 'Bzw komme doch, aber fünf Minuten später');
    const corrected = await attendance();
    await send(member, 'Ich komme nicht', { timestamp: earlier });
    expect(await attendance()).toEqual(corrected);
    const question = await send(member, 'Bzw komme doch, aber vielleicht fünf Minuten später');
    expect(await replyFor(question)).toContain('Noch wurde nichts geändert');
    expect(await attendance()).toEqual(corrected);
    await send(member, 'Paul sagt „Ich komme doch“');
    expect(await attendance()).toEqual(corrected);
  });
  it('clears stale arrival clocks when replacing them with minutes and clears lateness for an on-time arrival', async () => {
    await send(member, 'Ich komme erst um 18:20');
    expect(await attendance()).toMatchObject({ arrival_time: '18:20', minutes: 20 });
    await send(member, 'Korrektur: nur fünf Minuten später');
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'late',
      arrival_time: null,
      minutes: 5,
    });
    await send(member, 'Ich komme erst um 17:50');
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'punctual',
      arrival_time: null,
      minutes: null,
    });
  });
  it('asks for the training before applying a correction and resolves its clock against the selected start', async () => {
    await db
      .prepare(
        "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) SELECT 'second',group_jid,local_date,start_at+3600000,end_at+3600000,timezone,location,invite_at,late_at,created_at FROM training_sessions WHERE id='training'",
      )
      .run();
    const prompt = await send(member, 'Bzw ich komme doch, aber erst um 18:20');
    expect(await attendance()).toBeNull();
    expect(await replyFor(prompt)).toContain('Welches Training');
    await send(member, '1');
    expect(await attendance()).toMatchObject({
      response: 'yes',
      punctuality: 'late',
      minutes: 20,
      arrival_time: '18:20',
    });
    await send(member, 'Bzw ich komme doch, aber erst um 18:20');
    await send(member, '2');
    expect(
      await db
        .prepare(
          "SELECT response,punctuality,minutes,arrival_time FROM attendance WHERE session_id='second' AND user_id=?",
        )
        .bind(member.id)
        .first(),
    ).toEqual({ response: 'yes', punctuality: 'punctual', minutes: null, arrival_time: null });
  });
  it('issues only one private login link without a contact card or participant dialogue', async () => {
    const event = await send(owner, 'Ich möchte mich anmelden');
    expect(await replyFor(event)).toContain('/login#');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM conversations').first('n')).toBe(0);
    expect(
      await db
        .prepare('SELECT registered_at FROM users WHERE id=?')
        .bind(owner.id)
        .first('registered_at'),
    ).toBeNull();
  });
  it('hands reminder consent to the web in one message without enabling it', async () => {
    const event = await send(member, 'Erinnere mich bitte ans Training');
    expect(await replyFor(event)).toContain('/konto');
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(member.id).first('reminders'),
    ).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(1);
  });
  it('uses a quoted invitation and makes definite natural replies without commands', async () => {
    await send(member, 'Bin dabei', { isGroup: true, chatJid: group, quotedId: 'invitation' });
    expect(await attendance()).toMatchObject({ response: 'yes' });
    await send(member, 'Ich komme nicht', {
      isGroup: true,
      chatJid: group,
      quotedId: 'invitation',
    });
    expect(await attendance()).toMatchObject({ response: 'no' });
  });
  it('does not record tomorrow as today, and never binds a choice from another chat', async () => {
    await send(member, 'Ich komme morgen');
    expect(await attendance()).toBeNull();
    await db
      .prepare(
        "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) SELECT 'second',group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at FROM training_sessions WHERE id='training'",
      )
      .run();
    const first = await send(member, 'Ich komme');
    expect(await replyFor(first)).toContain('Nummer');
    await send(member, '1', { isGroup: true, chatJid: group });
    expect(await attendance()).toBeNull();
    await send(member, '1');
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE response='yes'").first('n'),
    ).toBe(1);
  });
  it('rejects stale quoted versions and choice versions, and evaluates arrival against actual start', async () => {
    await db.prepare("UPDATE training_sessions SET version=2 WHERE id='training'").run();
    const stale = await send(member, 'Bin dabei', {
      isGroup: true,
      chatJid: group,
      quotedId: 'invitation',
    });
    expect(await replyFor(stale)).toContain('geändert');
    expect(await attendance()).toBeNull();
    await send(member, 'Ich komme erst um 17:50');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'punctual' });
    await send(member, 'Ich komme erst um 18:10');
    expect(await attendance()).toMatchObject({ response: 'yes', punctuality: 'late', minutes: 10 });
  });
});

describe('separate account registration and personal consent', () => {
  it('registers without reminders, needs separate opt-in confirmation and stops already queued personal jobs', async () => {
    await send(member, '/registrieren');
    await send(member, 'JA');
    expect(
      await db
        .prepare('SELECT registered_at,reminders FROM users WHERE id=?')
        .bind(member.id)
        .first(),
    ).toMatchObject({ registered_at: expect.any(Number), reminders: 0 });
    await send(member, '/start');
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(member.id).first(),
    ).toEqual({ reminders: 0 });
    await send(member, 'JA');
    expect(
      await db.prepare('SELECT reminders FROM users WHERE id=?').bind(member.id).first(),
    ).toEqual({ reminders: 1 });
    await queue(
      db,
      {
        key: 'personal',
        chat: member.jid,
        userId: member.id,
        sessionId: 'training',
        version: 1,
        kind: 'personal_late',
        text: 'later',
      },
      clock,
    );
    await send(member, '/stop');
    expect(
      await db
        .prepare('SELECT registered_at,reminders FROM users WHERE id=?')
        .bind(member.id)
        .first(),
    ).toMatchObject({ registered_at: expect.any(Number), reminders: 0 });
    expect(
      await db.prepare("SELECT status FROM outbox_jobs WHERE dedupe_key='personal'").first(),
    ).toEqual({ status: 'cancelled' });
    expect(
      (
        await db
          .prepare('SELECT purpose,accepted FROM consents WHERE user_id=? ORDER BY created_at')
          .bind(member.id)
          .all()
      ).results,
    ).toEqual([
      { purpose: 'registration', accepted: 1 },
      { purpose: 'reminders', accepted: 1 },
      { purpose: 'reminders', accepted: 0 },
    ]);
  });
  it('requires private account commands and never registers a group sender from a public JA', async () => {
    const event = await send(member, '/login', { isGroup: true, chatJid: group });
    expect(await replyFor(event)).toContain('privat');
    await send(member, 'JA', { isGroup: true, chatJid: group });
    expect(
      await db
        .prepare('SELECT registered_at,reminders FROM users WHERE id=?')
        .bind(member.id)
        .first(),
    ).toEqual({ registered_at: null, reminders: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM consents').first()).toEqual({ n: 0 });
  });
});
