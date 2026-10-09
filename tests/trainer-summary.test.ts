import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/db';
import {
  attendanceSnapshot,
  planTrainerSummaries,
  preference,
} from '../apps/worker/src/trainer-summary';
import type { Training } from '../apps/worker/src/training';
import { sendOutbox } from '../apps/worker/src/outbox';
import type { EvolutionClient } from '@tt/whatsapp';
import type { Env } from '../apps/worker/src/types';

const start = Date.parse('2026-10-09T16:00:00Z'),
  due = start - 600_000,
  group = '120363123456@g.us';
let db: ReturnType<typeof testDb>, env: Env;
beforeEach(async () => {
  db = testDb();
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'test',
    EVOLUTION_API_KEY: 'fake',
  };
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'TT', due)
    .run();
  await db
    .prepare(
      "INSERT INTO users(id,jid,display_name,created_at) VALUES('trainer','491701234567@s.whatsapp.net','Trainer',?),('member','491701234568@s.whatsapp.net','Ada',?),('keeper','491701234569@s.whatsapp.net','Keeper',?)",
    )
    .bind(due, due, due)
    .run();
  await db
    .prepare(
      "INSERT INTO roles(user_id,role,created_at) VALUES('keeper','owner',?),('trainer','admin',?)",
    )
    .bind(due, due)
    .run();
  await db
    .prepare("INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'member',1,?)")
    .bind(group, due)
    .run();
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-09',?,?,'Europe/Berlin','Halle',?,?,?)",
    )
    .bind(group, start, start + 7200_000, due - 86400_000, start - 1800_000, due)
    .run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
async function optin(offset = 10) {
  await db
    .prepare(
      "INSERT INTO trainer_summary_preferences(user_id,enabled,offset_minutes,version,updated_at) VALUES('trainer',1,?,1,?)",
    )
    .bind(offset, due - 3600_000)
    .run();
  await db
    .prepare(
      "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('consent','trainer','trainer_summary','1',1,'optin',?)",
    )
    .bind(due - 3600_000)
    .run();
}
function provider() {
  const sendText = vi.fn(async (_chat: string, _text: string) => ({ id: crypto.randomUUID() }));
  return { sendText, client: { sendText } as unknown as EvolutionClient };
}

describe('personal trainer summaries', () => {
  it('distinguishes unnamed members with masked known phones or bounded user IDs, never LID digits', async () => {
    await db.prepare("UPDATE users SET display_name='' WHERE id='member'").run();
    await db
      .prepare(
        "INSERT INTO users(id,jid,created_at) VALUES('alias-user','987654321000001@lid',?),('lid-only','987654321000002@lid',?)",
      )
      .bind(due, due)
      .run();
    await db
      .prepare(
        "INSERT INTO identity_aliases(jid,user_id) VALUES('491701234570@s.whatsapp.net','alias-user')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'alias-user',1,?),(?,'lid-only',1,?)",
      )
      .bind(group, due, group, due)
      .run();
    const training = (await db
      .prepare("SELECT * FROM training_sessions WHERE id='training'")
      .first<Training>())!;
    const snapshot = await attendanceSnapshot(db, training);
    expect(snapshot.participants.map((p) => p.name).sort()).toEqual(
      ['Mitglied · …4568', 'Mitglied · …4570', 'Mitglied · lid-'].sort(),
    );
    expect(JSON.stringify(snapshot)).not.toContain('491701234');
    expect(JSON.stringify(snapshot)).not.toContain('987654321');
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES('training','member','no',?)",
      )
      .bind(due)
      .run();
    await optin();
    await planTrainerSummaries(db, due);
    const mock = provider();
    await sendOutbox(env, due, mock.client);
    expect(mock.sendText.mock.calls[0][1]).toContain('Mitglied · …4568');
    expect(mock.sendText.mock.calls[0][1]).not.toContain('491701234568');
  });
  it.each([
    { stored: '491701234599@s.whatsapp.net', configured: '491701234599@s.whatsapp.net' },
    { stored: '987654321098765@lid', configured: '491701234599@s.whatsapp.net' },
    { stored: '491701234599@s.whatsapp.net', configured: '987654321098765@lid' },
  ])(
    'excludes existing bot membership from both roster and summary via $configured',
    async ({ stored, configured }) => {
      await db
        .prepare("INSERT INTO settings(key,value) VALUES('bot_jid',?)")
        .bind(configured)
        .run();
      await db
        .prepare(
          "INSERT INTO users(id,jid,display_name,created_at) VALUES('bot',?,'Bot should never appear',?)",
        )
        .bind(stored, due)
        .run();
      if (stored !== configured)
        await db
          .prepare("INSERT INTO identity_aliases(jid,user_id) VALUES(?,'bot')")
          .bind(configured)
          .run();
      await db
        .prepare("INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,'bot',1,?)")
        .bind(group, due)
        .run();
      await db
        .prepare(
          "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES('training','bot','no',?)",
        )
        .bind(due)
        .run();
      const training = (await db
        .prepare("SELECT * FROM training_sessions WHERE id='training'")
        .first<Training>())!;
      const snapshot = await attendanceSnapshot(db, training);
      expect(snapshot.participants.map((p) => p.userId)).toEqual(['member']);
      expect(snapshot.counts).toEqual({ yes: 0, no: 0, late: 0, unanswered: 1, total: 1 });
      await optin();
      await planTrainerSummaries(db, due);
      const mock = provider();
      await sendOutbox(env, due, mock.client);
      expect(mock.sendText.mock.calls[0][1]).toContain('Mitglieder: 1');
      expect(mock.sendText.mock.calls[0][1]).not.toContain('Bot should never appear');
      expect(
        await db.prepare("SELECT active FROM memberships WHERE user_id='bot'").first(),
      ).toEqual({ active: 1 });
    },
  );
  it('defaults off and requires explicit latest consent but no participant registration', async () => {
    expect(preference()).toEqual({
      enabled: false,
      offsetMinutes: 10,
      includeAbsent: true,
      includeLate: true,
      includeCounts: true,
      version: 0,
    });
    await planTrainerSummaries(db, due);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
    await optin();
    await db.prepare('DELETE FROM consents').run();
    await planTrainerSummaries(db, due);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
    await db
      .prepare(
        "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('accepted','trainer','trainer_summary','1',1,'yes',?)",
      )
      .bind(due - 1)
      .run();
    await planTrainerSummaries(db, due);
    const mock = provider();
    expect(await sendOutbox(env, due, mock.client)).toBe(1);
    expect(mock.sendText).toHaveBeenCalledWith(
      '491701234567@s.whatsapp.net',
      expect.stringContaining('Trainerübersicht'),
    );
    expect(
      await db.prepare("SELECT registered_at,reminders FROM users WHERE id='trainer'").first(),
    ).toEqual({ registered_at: null, reminders: 0 });
  });
  it('uses the chosen due time and snapshots latest attendance at send, with durable deduplication', async () => {
    await optin(0);
    await planTrainerSummaries(db, due);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
    await planTrainerSummaries(db, start);
    await planTrainerSummaries(db, start);
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,punctuality,minutes,updated_at) VALUES('training','member','yes','late',12,?)",
      )
      .bind(start)
      .run();
    const mock = provider();
    expect(await sendOutbox(env, start, mock.client)).toBe(1);
    expect(mock.sendText.mock.calls[0][1]).toContain('Ada (ca. 12 Min.)');
    expect(mock.sendText.mock.calls[0][1]).toContain('Zusagen: 1');
    await planTrainerSummaries(db, start + 1);
    expect(await sendOutbox(env, start + 1, mock.client)).toBe(0);
    expect(mock.sendText).toHaveBeenCalledTimes(1);
  });
  it.each(['role', 'consent', 'preference', 'session', 'privacy'] as const)(
    'blocks a planned job after %s changes',
    async (reason) => {
      await optin();
      await planTrainerSummaries(db, due);
      if (reason === 'role') await db.prepare("DELETE FROM roles WHERE user_id='trainer'").run();
      if (reason === 'consent')
        await db
          .prepare(
            "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES('revoked','trainer','trainer_summary','1',0,'stop',?)",
          )
          .bind(due)
          .run();
      if (reason === 'preference')
        await db.prepare('UPDATE trainer_summary_preferences SET version=version+1').run();
      if (reason === 'session')
        await db.prepare('UPDATE training_sessions SET version=version+1').run();
      if (reason === 'privacy')
        await db.prepare("UPDATE settings SET value='0' WHERE key='privacy_ready'").run();
      const mock = provider();
      expect(await sendOutbox(env, due, mock.client)).toBe(0);
      expect(mock.sendText).not.toHaveBeenCalled();
      expect(await db.prepare('SELECT status FROM outbox_jobs').first()).toEqual({
        status: 'cancelled',
      });
    },
  );
  it('rechecks role after reading current summary data and immediately before provider send', async () => {
    await optin();
    await planTrainerSummaries(db, due);
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = original(sql);
      if (sql.includes('FROM memberships m JOIN users u')) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...args) => {
          const bound = bind(...args),
            all = bound.all.bind(bound);
          bound.all = async <T>() => {
            const result = await all<T>();
            await original("DELETE FROM roles WHERE user_id='trainer'").run();
            return result;
          };
          return bound;
        };
      }
      return statement;
    });
    const mock = provider();
    expect(await sendOutbox(env, due, mock.client)).toBe(0);
    expect(mock.sendText).not.toHaveBeenCalled();
  });
  it('never sends a catch-up summary for a new opt-in or an expired training', async () => {
    await optin();
    await db
      .prepare('UPDATE trainer_summary_preferences SET updated_at=?')
      .bind(due + 1)
      .run();
    await planTrainerSummaries(db, due + 2);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
    await db
      .prepare('UPDATE trainer_summary_preferences SET updated_at=?')
      .bind(due - 1)
      .run();
    await planTrainerSummaries(db, start + 900_000);
    expect(await db.prepare('SELECT COUNT(*) n FROM outbox_jobs').first()).toEqual({ n: 0 });
  });
  it('does not send a cancelled lease even when trainer consent is still enabled', async () => {
    await optin();
    await planTrainerSummaries(db, due);
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = original(sql);
      if (sql.includes('FROM memberships m JOIN users u')) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...args) => {
          const bound = bind(...args),
            all = bound.all.bind(bound);
          bound.all = async <T>() => {
            const result = await all<T>();
            await original("UPDATE outbox_jobs SET status='cancelled'").run();
            return result;
          };
          return bound;
        };
      }
      return statement;
    });
    const mock = provider();
    expect(await sendOutbox(env, due, mock.client)).toBe(0);
    expect(mock.sendText).not.toHaveBeenCalled();
    expect(await original('SELECT status FROM outbox_jobs').first()).toEqual({
      status: 'cancelled',
    });
  });
  it('honors content toggles without names from other groups or memberships', async () => {
    await optin();
    await db
      .prepare(
        'UPDATE trainer_summary_preferences SET include_absent=0,include_late=0,include_counts=1',
      )
      .run();
    await db
      .prepare(
        "INSERT INTO attendance(session_id,user_id,response,updated_at) VALUES('training','member','no',?)",
      )
      .bind(due)
      .run();
    await planTrainerSummaries(db, due);
    const mock = provider();
    await sendOutbox(env, due, mock.client);
    expect(mock.sendText.mock.calls[0][1]).toContain('Absagen: 1');
    expect(mock.sendText.mock.calls[0][1]).not.toContain('Ada');
  });
});
