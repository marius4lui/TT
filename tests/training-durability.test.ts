import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from './helpers/db';
import { processMessage } from '../apps/worker/src/bot';
import { resolveUser } from '../apps/worker/src/auth';
import { occurrence } from '@tt/core';
import type { MessageEvent } from '@tt/whatsapp';
import type { Env, User } from '../apps/worker/src/types';

let db: ReturnType<typeof testDb>, env: Env, owner: User, clock: number;
const group = '120363123456@g.us';
const times = occurrence({ weekday: 4, startTime: '18:00', endTime: '20:00' }, '2026-10-08');
beforeEach(async () => {
  db = testDb();
  clock = Date.parse('2026-10-08T12:00:00Z');
  env = {
    DB: db,
    ASSETS: {
      fetch: async () => new Response(''),
      connect: () => {
        throw new Error('unused');
      },
    },
    EVOLUTION_URL: 'https://evolution.invalid',
    EVOLUTION_INSTANCE: 'fixture',
    EVOLUTION_API_KEY: 'fixture',
  };
  owner = (await resolveUser(env, '491701234567@s.whatsapp.net', [], 'Owner', clock))!;
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?)")
    .bind(owner.id, clock)
    .run();
  await db
    .prepare('INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?)')
    .bind(group, 'Training', clock)
    .run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('selected_group',?)").bind(group).run();
  await db.prepare("UPDATE settings SET value='1' WHERE key IN ('enabled','privacy_ready')").run();
  await db
    .prepare(
      "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES('training',?,'2026-10-08',?,?,'Europe/Berlin','Halle',?,?,?)",
    )
    .bind(group, times.startAt, times.endAt, times.reminderAt, times.lateReminderAt, clock)
    .run();
  await db
    .prepare(
      "INSERT INTO outbox_jobs(id,dedupe_key,chat_jid,session_id,session_version,kind,text,due_at,expires_at,created_at) VALUES('old','old',?,'training',1,'invite','Old invitation',?,?,?)",
    )
    .bind(group, clock, times.endAt, clock)
    .run();
  await db
    .prepare(
      "INSERT INTO messages(id,chat_jid,session_id,session_version,kind,created_at) VALUES('sent',?,'training',1,'invite',?)",
    )
    .bind(group, clock)
    .run();
});
afterEach(() => db.close());
function event(text: string): MessageEvent {
  clock += 1000;
  return {
    id: crypto.randomUUID(),
    chatJid: owner.jid,
    senderJid: owner.jid,
    aliases: [owner.jid],
    displayName: 'Owner',
    timestamp: clock,
    isGroup: false,
    text,
  };
}
async function send(text: string): Promise<MessageEvent> {
  const e = event(text);
  await processMessage(env, e, clock);
  return e;
}
async function count(table: string): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n'))!;
}
function interceptCommand(
  hook: (
    statements: D1PreparedStatement[],
    run: (s: D1PreparedStatement[]) => Promise<D1Result[]>,
  ) => Promise<D1Result[]>,
): void {
  const original = db.batch.bind(db);
  db.batch = (async (statements) => {
    if (statements.length < 4) return original(statements);
    db.batch = original;
    return hook(statements, original);
  }) as typeof db.batch;
}

describe('atomic trainer commands', () => {
  it.each(['/verschieben training 2026-10-09 19:00', '/ausfall training'])(
    'retains the pending confirmation and rolls back every effect when a batch fails: %s',
    async (command) => {
      await send(command);
      const confirmation = event('/bestätigen');
      interceptCommand((statements, run) =>
        run([...statements, db.prepare('INSERT INTO missing_table(value) VALUES(1)')]),
      );
      await expect(processMessage(env, confirmation, clock)).rejects.toThrow();
      expect(
        await db
          .prepare("SELECT status,version,start_at FROM training_sessions WHERE id='training'")
          .first(),
      ).toEqual({ status: 'scheduled', version: 1, start_at: times.startAt });
      expect(
        await db.prepare("SELECT status FROM outbox_jobs WHERE id='old'").first('status'),
      ).toBe('pending');
      expect(await count('command_receipts')).toBe(0);
      expect(await count('audit_log')).toBe(0);
      expect(await count('conversations')).toBe(1);
      expect(
        await db.prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind='change'").first('n'),
      ).toBe(0);
      await processMessage(env, confirmation, clock + 1);
      expect(await count('command_receipts')).toBe(1);
      expect(await count('conversations')).toBe(0);
      expect(
        await db.prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind='change'").first('n'),
      ).toBe(1);
    },
  );
  it('commits notifications, audit and reply with the mutation and safely replays after a postcommit crash', async () => {
    await send('/verschieben training 2026-10-09 19:00');
    const confirmation = event('/bestätigen');
    interceptCommand(async (statements, run) => {
      await run(statements);
      throw new Error('simulated_postcommit_crash');
    });
    await expect(processMessage(env, confirmation, clock)).rejects.toThrow('postcommit');
    expect(await count('command_receipts')).toBe(1);
    expect(await count('conversations')).toBe(0);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`reply:${confirmation.id}:0`)
        .first('n'),
    ).toBe(1);
    await processMessage(env, confirmation, clock + 1);
    expect(
      await db
        .prepare("SELECT version FROM training_sessions WHERE id='training'")
        .first('version'),
    ).toBe(2);
    expect(await count('audit_log')).toBe(1);
    expect(await count('command_receipts')).toBe(1);
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind='change'").first('n'),
    ).toBe(1);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM outbox_jobs WHERE dedupe_key=?')
        .bind(`reply:${confirmation.id}:0`)
        .first('n'),
    ).toBe(1);
  });
  it('aborts if a concurrent edit changes the session after it was read', async () => {
    await send('/verschieben training 2026-10-09 19:00');
    const confirmation = event('/bestätigen');
    interceptCommand(async (statements, run) => {
      await db.prepare("UPDATE training_sessions SET version=2 WHERE id='training'").run();
      return run(statements);
    });
    await expect(processMessage(env, confirmation, clock)).rejects.toThrow('CHECK');
    expect(
      await db
        .prepare("SELECT version,start_at FROM training_sessions WHERE id='training'")
        .first(),
    ).toEqual({ version: 2, start_at: times.startAt });
    expect(await count('command_receipts')).toBe(0);
    expect(await count('conversations')).toBe(1);
    expect(await db.prepare("SELECT status FROM outbox_jobs WHERE id='old'").first('status')).toBe(
      'pending',
    );
  });
  it('checks trainer permission inside the mutation transaction', async () => {
    const successor = (await resolveUser(
      env,
      '491701234568@s.whatsapp.net',
      [],
      'Successor',
      clock,
    ))!;
    await db
      .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'owner',?)")
      .bind(successor.id, clock)
      .run();
    await send('/ausfall training');
    const confirmation = event('/bestätigen');
    interceptCommand(async (statements, run) => {
      await db.prepare('DELETE FROM roles WHERE user_id=?').bind(owner.id).run();
      return run(statements);
    });
    await expect(processMessage(env, confirmation, clock)).rejects.toThrow('CHECK');
    expect(
      await db.prepare("SELECT status FROM training_sessions WHERE id='training'").first('status'),
    ).toBe('scheduled');
    expect(await count('conversations')).toBe(1);
    expect(await count('command_receipts')).toBe(0);
  });
  it('does not consume a newer dialog that replaced the staged operation', async () => {
    await send('/ausfall training');
    const confirmation = event('/bestätigen');
    interceptCommand(async (statements, run) => {
      await db.prepare("UPDATE conversations SET data='{}' WHERE user_id=?").bind(owner.id).run();
      return run(statements);
    });
    await expect(processMessage(env, confirmation, clock)).rejects.toThrow('CHECK');
    expect(
      await db
        .prepare('SELECT data FROM conversations WHERE user_id=?')
        .bind(owner.id)
        .first('data'),
    ).toBe('{}');
    expect(
      await db.prepare("SELECT status FROM training_sessions WHERE id='training'").first('status'),
    ).toBe('scheduled');
  });
  it('notifies cancellation when a previous invitation might have been delivered', async () => {
    await db.prepare('DELETE FROM messages').run();
    await db.prepare("UPDATE outbox_jobs SET status='uncertain' WHERE id='old'").run();
    await send('/ausfall training');
    await send('/bestätigen');
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM outbox_jobs WHERE kind='change'").first('n'),
    ).toBe(1);
  });
  it('rejects a confirmation timestamp that predates the staged action', async () => {
    const staged = await send('/ausfall training');
    const confirmation = event('/bestätigen');
    confirmation.timestamp = staged.timestamp - 1000;
    await processMessage(env, confirmation, clock);
    expect(
      await db.prepare("SELECT status FROM training_sessions WHERE id='training'").first('status'),
    ).toBe('scheduled');
    expect(await count('conversations')).toBe(1);
    expect(await count('command_receipts')).toBe(0);
  });
});
