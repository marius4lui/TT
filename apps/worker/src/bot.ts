import {
  normalizeEmoji,
  attendanceIntent,
  chatIntent,
  type AttendanceIntent,
  reduceAttendance,
  occurrence,
  localTimestamp,
  parseDate,
  type AttendanceState,
  type AttendanceChange,
} from '@tt/core';
import type { MessageEvent } from '@tt/whatsapp';
import { getRole, handleAccountMessage, resolveUser } from './auth';
import { all, setting } from './db';
import type { Env, BotContext, User } from './types';
import { evolution, queue } from './outbox';
import { requestGroupLink } from './group-requests';
import { answerTrainingQuestion } from './questions';
import {
  dateInZone,
  findTraining,
  label,
  materialize,
  movedTimes,
  shortId,
  upcoming,
  type Training,
  type Series,
} from './training';

interface Conversation {
  kind: string;
  data: string;
  expires_at: number;
}
type Operation = { kind: string; [key: string]: unknown };
const HELP = `🏓 TT – TTBot\n\nTeilnahme: Reagiere mit 👍 oder 👎 auf die Einladung. Verspätung: ⏰ auf die zweite Nachricht oder /spät TERMIN [MINUTEN].\n/ja TERMIN · /nein TERMIN · /pünktlich TERMIN\n/login – freiwilliges Konto\n/start · /stop – persönliche Erinnerungen\n/konto · /daten · /löschen\n\nTrainer (privat):\n/gruppen · /gruppe JID\n/training – Trainingsserie einrichten\n/termine · /übersicht [TERMIN]\n/ausfall DATUM\n/pause VON BIS\n/verschieben TERMIN DATUM UHRZEIT\n/sondertraining DATUM BEGINN ENDE [ORT]\n/serie beenden ID\n/info TEXT · /datenschutz TEXT\n/aktivieren · /deaktivieren · /status\n/admin – Adminverwaltung\n/bestätigen · /abbrechen`;
const commandName = (s: string) =>
  s
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
async function reply(ctx: BotContext, text: string, index = 0): Promise<void> {
  const exists = ctx.isGroup
    ? null
    : await ctx.env.DB.prepare('SELECT id FROM users WHERE id=?').bind(ctx.user.id).first();
  await queue(
    ctx.env.DB,
    {
      key: `reply:${ctx.eventId}:${index}`,
      chat: ctx.chatJid,
      userId: exists ? ctx.user.id : undefined,
      text:
        !ctx.isGroup && !exists
          ? 'Die Aktion ist abgeschlossen. Dein TT-Konto ist derzeit nicht vorhanden.'
          : text,
    },
    ctx.now,
  );
}
async function conversation(ctx: BotContext): Promise<Conversation | null> {
  return ctx.env.DB.prepare('SELECT * FROM conversations WHERE user_id=? AND expires_at>?')
    .bind(ctx.user.id, ctx.now)
    .first<Conversation>();
}
async function saveConversation(ctx: BotContext, kind: string, data: unknown): Promise<void> {
  await ctx.env.DB.prepare(
    'INSERT INTO conversations(user_id,kind,data,expires_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,data=excluded.data,expires_at=excluded.expires_at',
  )
    .bind(ctx.user.id, kind, JSON.stringify(data), ctx.now + 600000)
    .run();
}
async function stage(ctx: BotContext, op: Operation, summary: string): Promise<void> {
  await saveConversation(ctx, 'training:confirm', { ...op, stagedAt: ctx.timestamp });
  await reply(ctx, `${summary}\n\nMit /bestätigen übernehmen oder /abbrechen.`);
}
async function chosenGroup(db: D1Database): Promise<string> {
  return setting(db, 'selected_group');
}
async function admin(ctx: BotContext): Promise<boolean> {
  return !ctx.isGroup && !!(await getRole(ctx.env.DB, ctx.user.id));
}
async function requireGroup(ctx: BotContext): Promise<string | null> {
  const group = await chosenGroup(ctx.env.DB);
  if (!group) {
    await reply(ctx, 'Wähle zuerst eine Gruppe: /gruppen und anschließend /gruppe JID.');
    return null;
  }
  return group;
}
async function selectTraining(ctx: BotContext, reference?: string): Promise<Training | null> {
  const isAdmin = await admin(ctx);
  const group = ctx.isGroup ? ctx.chatJid : isAdmin ? await chosenGroup(ctx.env.DB) : undefined;
  let rows = reference
    ? await findTraining(ctx.env.DB, reference, ctx.now, group || undefined)
    : (await upcoming(ctx.env.DB, ctx.now, group || undefined)).filter(
        (t) => t.status === 'scheduled',
      );
  if (!isAdmin && !ctx.isGroup) {
    const memberships = await all<{ group_jid: string }>(
      ctx.env.DB,
      'SELECT group_jid FROM memberships WHERE user_id=? AND active=1',
      ctx.user.id,
    );
    rows = rows.filter((t) => memberships.some((m) => m.group_jid === t.group_jid));
  }
  if (rows.length === 1 || (!reference && rows.length > 0 && isAdmin)) return rows[0];
  if (!reference) {
    const current = rows.filter((t) => t.start_at - 6 * 3600000 <= ctx.now && t.end_at > ctx.now);
    if (current.length === 1) return current[0];
  }
  if (rows.length === 0)
    await reply(
      ctx,
      'Dazu finde ich kein bevorstehendes Training. Mit /termine siehst du die Termine.',
    );
  else
    await reply(
      ctx,
      `Bitte wähle die Termin-ID:\n${rows
        .slice(0, 6)
        .map((t) => `${t.id} · ${label(t)}`)
        .join('\n')}`,
    );
  return null;
}
export function notifyChange(
  ctx: BotContext,
  t: Training,
  message: string,
  onlyIfInvited = false,
): D1PreparedStatement[] {
  // Recipients and consent are selected inside the command transaction.
  const invited = onlyIfInvited
    ? `AND (EXISTS(SELECT 1 FROM messages WHERE session_id=s.id AND kind IN ('invite','personal_invite')) OR EXISTS(SELECT 1 FROM outbox_jobs WHERE session_id=s.id AND kind IN ('invite','personal_invite') AND status IN ('sent','processing','uncertain')))`
    : '';
  const expires = Math.max(ctx.now + 3600000, t.end_at),
    key = `change:${ctx.eventId}:${t.id}:`;
  return [
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,session_id,session_version,kind,text,due_at,expires_at,created_at)
      SELECT ?,?,s.group_jid,s.id,s.version,'change',?,?,?,? FROM training_sessions s WHERE s.id=? AND s.version=? ${invited}`,
    ).bind(crypto.randomUUID(), `${key}group`, message, ctx.now, expires, ctx.now, t.id, t.version),
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,session_id,session_version,kind,text,due_at,expires_at,created_at)
      SELECT lower(hex(randomblob(16))),?||u.id,u.jid,u.id,s.id,s.version,'personal_change',?,?,?,?
      FROM training_sessions s JOIN memberships m ON m.group_jid=s.group_jid JOIN users u ON u.id=m.user_id
      WHERE s.id=? AND s.version=? AND m.active=1 AND u.reminders=1 AND u.registered_at IS NOT NULL ${invited}`,
    ).bind(key, message, ctx.now, expires, ctx.now, t.id, t.version),
  ];
}
export function cancelSessions(ctx: BotContext, sessions: Training[]): D1PreparedStatement[] {
  return sessions.flatMap((t) => [
    ctx.env.DB.prepare(
      "UPDATE training_sessions SET status='cancelled',version=version+1 WHERE id=? AND version=? AND status='scheduled'",
    ).bind(t.id, t.version),
    ...notifyChange(
      ctx,
      { ...t, version: t.version + 1, status: 'cancelled' },
      `❌ Training abgesagt\n${label(t)}\nBereits eingetragene Zusagen sind damit hinfällig.`,
      true,
    ),
    ctx.env.DB.prepare(
      "UPDATE outbox_jobs SET status='cancelled' WHERE session_id=? AND session_version!=? AND status IN ('pending','processing')",
    ).bind(t.id, t.version + 1),
  ]);
}
function commandReply(ctx: BotContext, text: string): D1PreparedStatement {
  return ctx.env.DB.prepare(
    "INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at) VALUES(?,?,?,?,'reply',?,?,?,?)",
  ).bind(
    crypto.randomUUID(),
    `reply:${ctx.eventId}:0`,
    ctx.chatJid,
    ctx.user.id,
    text,
    ctx.now,
    ctx.now + 3600000,
    ctx.now,
  );
}
async function confirmOperation(
  ctx: BotContext,
  op: Operation,
  dialog: Conversation,
): Promise<void> {
  const db = ctx.env.DB,
    group = String(op.group ?? ''),
    statements: D1PreparedStatement[] = [];
  const guards: string[] = [],
    values: (string | number)[] = [];
  const guard = (sql: string, ...params: (string | number)[]) => {
    guards.push(sql);
    values.push(...params);
  };
  const guardSessions = (sessions: Training[]) =>
    guard(
      `NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN training_sessions s ON s.id=json_extract(snapshot.value,'$.id')
    WHERE s.id IS NULL OR s.version!=json_extract(snapshot.value,'$.version') OR s.status!='scheduled')`,
      JSON.stringify(sessions.map((t) => ({ id: t.id, version: t.version }))),
    );
  if (ctx.timestamp <= Number(op.stagedAt ?? 0)) {
    await reply(
      ctx,
      'Diese Bestätigung ist älter als der aktuelle Dialog. Bitte bestätige den angezeigten Vorgang erneut.',
    );
    return;
  }
  if (op.kind === 'group') {
    // Confirm current membership, not the potentially ten-minute-old staged snapshot.
    const current = (await evolution(ctx.env).fetchGroups()).find((g) => g.id === group);
    if (!current) {
      await reply(ctx, 'Die Gruppe gehört nicht mehr zur Botinstanz. Bitte beginne erneut.');
      return;
    }
    const members: string[] = [];
    for (const p of current.participants) {
      const u = await resolveUser(ctx.env, p.id, p.aliases ?? [], '', ctx.now);
      if (u) members.push(u.id);
    }
    statements.push(
      db
        .prepare(
          'INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,1,?) ON CONFLICT(jid) DO UPDATE SET active=1,name=excluded.name',
        )
        .bind(group, current.subject, ctx.now),
      db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('selected_group',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind(group),
      db
        .prepare('UPDATE memberships SET active=0,updated_at=? WHERE group_jid=? AND updated_at<=?')
        .bind(ctx.now, group, ctx.now),
    );
    for (const id of members)
      statements.push(
        db
          .prepare(
            'INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?) ON CONFLICT(group_jid,user_id) DO UPDATE SET active=1,updated_at=excluded.updated_at WHERE memberships.updated_at<=excluded.updated_at',
          )
          .bind(group, id, ctx.now),
      );
  } else if (op.kind === 'series') {
    const spec = op.spec as {
      weekday: number;
      startTime: string;
      endTime: string;
      location: string;
      reminderTime: string;
      lateReminderMinutes: number;
    };
    if (
      await db
        .prepare(
          'SELECT id FROM training_series WHERE group_jid=? AND weekday=? AND start_time=? AND active=1',
        )
        .bind(group, spec.weekday, spec.startTime)
        .first()
    ) {
      await reply(ctx, 'Diese Trainingsserie gibt es bereits.');
      return;
    }
    guard(
      'NOT EXISTS(SELECT 1 FROM training_series WHERE group_jid=? AND weekday=? AND start_time=? AND active=1)',
      group,
      spec.weekday,
      spec.startTime,
    );
    guard('EXISTS(SELECT 1 FROM groups WHERE jid=? AND active=1)', group);
    statements.push(
      db
        .prepare(
          `INSERT INTO training_series(id,group_jid,weekday,start_time,end_time,timezone,location,reminder_time,late_offset,created_at) VALUES(?,?,?,?,?,'Europe/Berlin',?,?,?,?)`,
        )
        .bind(
          String(op.id),
          group,
          spec.weekday,
          spec.startTime,
          spec.endTime,
          spec.location,
          spec.reminderTime,
          spec.lateReminderMinutes,
          ctx.now,
        ),
      db.prepare("DELETE FROM settings WHERE key='materialized_date'"),
    );
  } else if (op.kind === 'cancel' || op.kind === 'move') {
    const t = await db
      .prepare('SELECT * FROM training_sessions WHERE id=?')
      .bind(String(op.id))
      .first<Training>();
    if (!t || t.version !== op.version || t.status !== 'scheduled') {
      await db.batch([
        commandReply(ctx, 'Der Termin wurde inzwischen geändert. Bitte beginne erneut.'),
        db
          .prepare(
            "DELETE FROM conversations WHERE user_id=? AND kind='training:confirm' AND data=?",
          )
          .bind(ctx.user.id, dialog.data),
      ]);
      return;
    }
    guardSessions([t]);
    if (op.kind === 'cancel') {
      if (t.series_id)
        statements.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO training_exceptions(id,series_id,from_date,to_date,kind,created_at) VALUES(?,?,?,?,'cancel',?)",
            )
            .bind(`cancel:${t.id}`, t.series_id, t.local_date, t.local_date, ctx.now),
        );
      statements.push(...cancelSessions(ctx, [t]));
    } else {
      const times = movedTimes(t, String(op.date), String(op.time));
      if (times.start <= ctx.now) {
        await reply(ctx, 'Der neue Beginn liegt bereits in der Vergangenheit.');
        return;
      }
      const moved = {
        ...t,
        start_at: times.start,
        end_at: times.end,
        invite_at: times.invite,
        late_at: times.late,
        version: t.version + 1,
      };
      statements.push(
        db
          .prepare(
            'UPDATE training_sessions SET start_at=?,end_at=?,invite_at=?,late_at=?,version=version+1 WHERE id=? AND version=?',
          )
          .bind(times.start, times.end, times.invite, times.late, t.id, t.version),
        db.prepare('UPDATE attendance SET needs_confirmation=1 WHERE session_id=?').bind(t.id),
        db
          .prepare(
            "UPDATE outbox_jobs SET status='cancelled' WHERE session_id=? AND status IN ('pending','processing')",
          )
          .bind(t.id),
        ...notifyChange(
          ctx,
          moved,
          `↪️ Training verschoben\n${label(moved)}\nBitte bestätige deine Teilnahme erneut auf der neuen Einladung.`,
        ),
      );
    }
  } else if (op.kind === 'pause' || op.kind === 'endSeries') {
    const condition =
      op.kind === 'pause'
        ? "group_jid=? AND local_date>=? AND local_date<=? AND end_at>? AND status='scheduled'"
        : "series_id=? AND end_at>? AND status='scheduled'";
    const params =
      op.kind === 'pause'
        ? [group, String(op.from), String(op.to), ctx.now]
        : [String(op.id), ctx.now];
    const sessions = await all<Training>(
      db,
      `SELECT * FROM training_sessions WHERE ${condition}`,
      ...params,
    );
    guard(
      `(SELECT COUNT(*) FROM training_sessions WHERE ${condition})=?`,
      ...params,
      sessions.length,
    );
    guardSessions(sessions);
    if (op.kind === 'pause') {
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO training_exceptions(id,series_id,from_date,to_date,kind,created_at) SELECT ?||':'||id,id,?,?,'pause',? FROM training_series WHERE group_jid=? AND active=1",
          )
          .bind(String(op.id), String(op.from), String(op.to), ctx.now, group),
      );
    } else {
      guard('EXISTS(SELECT 1 FROM training_series WHERE id=? AND active=1)', String(op.id));
      statements.push(
        db.prepare('UPDATE training_series SET active=0 WHERE id=?').bind(String(op.id)),
      );
    }
    statements.push(...cancelSessions(ctx, sessions));
  } else if (op.kind === 'special') {
    const t = op.training as Training;
    if (t.start_at <= ctx.now) {
      await reply(ctx, 'Der Beginn liegt bereits in der Vergangenheit.');
      return;
    }
    guard('EXISTS(SELECT 1 FROM groups WHERE jid=? AND active=1)', t.group_jid);
    statements.push(
      db
        .prepare(
          'INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
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
          ctx.now,
        ),
    );
  } else if (op.kind === 'setting') {
    const name = String(op.name);
    if (!['info_text', 'privacy_text', 'enabled'].includes(name))
      throw new Error('invalid_setting');
    if (name === 'enabled' && op.value === '1')
      guard(
        "EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1') AND EXISTS(SELECT 1 FROM groups WHERE jid=(SELECT value FROM settings WHERE key='selected_group') AND active=1)",
      );
    statements.push(
      db
        .prepare(
          'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        .bind(name, String(op.value)),
    );
    if (name === 'privacy_text')
      statements.push(db.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'"));
    if (name === 'enabled' && op.value === '0')
      statements.push(
        db.prepare(
          "UPDATE outbox_jobs SET status='cancelled' WHERE status IN ('pending','processing') AND kind IN ('invite','late','personal_invite','personal_late','personal_change')",
        ),
      );
    if (name === 'enabled' && op.value === '1')
      statements.push(
        db
          .prepare(
            "UPDATE outbox_jobs SET status='pending' WHERE status='cancelled' AND expires_at>? AND due_at>? AND kind IN ('invite','late','personal_invite','personal_late')",
          )
          .bind(ctx.now, ctx.now),
      );
  } else if (op.kind === 'retry') {
    guard(
      "EXISTS(SELECT 1 FROM outbox_jobs WHERE id=? AND status IN ('failed','uncertain') AND expires_at>?)",
      String(op.id),
      ctx.now,
    );
    statements.push(
      db
        .prepare(
          "UPDATE outbox_jobs SET status='pending',attempts=0,due_at=?,error=NULL WHERE id=? AND status IN ('failed','uncertain') AND expires_at>?",
        )
        .bind(ctx.now, String(op.id), ctx.now),
    );
  } else throw new Error('invalid_operation');
  await db.batch([
    db
      .prepare(
        `INSERT INTO command_receipts(event_id,user_id,created_at,guard) VALUES(?,?,?,
      EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role IN ('owner','admin'))
      AND EXISTS(SELECT 1 FROM conversations WHERE user_id=? AND kind='training:confirm' AND data=? AND expires_at>?)
      ${guards.map((sql) => `AND (${sql})`).join(' ')})`,
      )
      .bind(
        ctx.eventId,
        ctx.user.id,
        ctx.now,
        ctx.user.id,
        ctx.user.id,
        dialog.data,
        ctx.now,
        ...values,
      ),
    ...statements,
    db
      .prepare('INSERT INTO audit_log(id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)')
      .bind(
        crypto.randomUUID(),
        ctx.user.id,
        `training:${op.kind}`,
        JSON.stringify({ id: op.id ?? null, group: group || null }),
        ctx.now,
      ),
    commandReply(ctx, '✅ Übernommen. Mit /termine oder /status siehst du den aktuellen Stand.'),
    db
      .prepare("DELETE FROM conversations WHERE user_id=? AND kind='training:confirm' AND data=?")
      .bind(ctx.user.id, dialog.data),
  ]);
  if (op.kind === 'series') await materialize(db, ctx.now, true);
}
const WIZARD_QUESTIONS = [
  'An welchem Wochentag? 1 Montag · 2 Dienstag · 3 Mittwoch · 4 Donnerstag · 5 Freitag · 6 Samstag · 7 Sonntag',
  'Wann beginnt das Training? Bitte HH:MM, zum Beispiel 18:00.',
  'Wann endet das Training? Bitte HH:MM.',
  'Wo findet das Training statt?',
  'Um wie viel Uhr soll am Vortag eingeladen werden? Bitte HH:MM, zum Beispiel 18:00.',
  'Wie viele Minuten vor Beginn soll die Verspätungsnachricht kommen? 30 ist der Standard; 0 bedeutet bei Beginn.',
];
async function wizard(ctx: BotContext, c: Conversation): Promise<void> {
  const data = JSON.parse(c.data) as { group: string; step: number; answers: string[] };
  const value = ctx.text.trim();
  const i = data.step;
  const weekdays: Record<string, string> = {
    montag: '1',
    dienstag: '2',
    mittwoch: '3',
    donnerstag: '4',
    freitag: '5',
    samstag: '6',
    sonntag: '7',
  };
  const answer = i === 0 ? (weekdays[value.toLowerCase()] ?? value) : value;
  const valid =
    i === 0
      ? /^[1-7]$/.test(answer)
      : [1, 2, 4].includes(i)
        ? /^([01]\d|2[0-3]):[0-5]\d$/.test(answer)
        : i === 3
          ? answer.length >= 2 && answer.length <= 200
          : /^\d{1,3}$/.test(answer) && Number(answer) <= 240;
  if (!valid) {
    await reply(ctx, `Das konnte ich nicht eindeutig lesen.\n${WIZARD_QUESTIONS[i]}`);
    return;
  }
  data.answers.push(answer);
  data.step++;
  if (data.step < WIZARD_QUESTIONS.length) {
    await saveConversation(ctx, 'training:wizard', data);
    await reply(ctx, WIZARD_QUESTIONS[data.step]);
    return;
  }
  const [weekday, startTime, endTime, location, reminderTime, lateMinutes] = data.answers;
  const spec = {
    weekday: Number(weekday) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    startTime,
    endTime,
    location,
    reminderTime,
    lateReminderMinutes: Number(lateMinutes),
  };
  if (endTime <= startTime) {
    await ctx.env.DB.prepare('DELETE FROM conversations WHERE user_id=?').bind(ctx.user.id).run();
    await reply(
      ctx,
      'Das Ende muss nach dem Beginn am selben Tag liegen. Bitte starte /training erneut.',
    );
    return;
  }
  occurrence(spec, dateInZone(ctx.now)); // Validate local clock values and durations.
  await stage(
    ctx,
    { kind: 'series', id: shortId(), group: data.group, spec },
    `Neue wöchentliche Serie: ${['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][spec.weekday]}, ${startTime}–${endTime}, ${location}.\nEinladung am Vortag ${reminderTime}; Verspätungsnachricht ${lateMinutes} Minuten vor Beginn.`,
  );
}
async function adminCommand(ctx: BotContext, cmd: string, args: string[]): Promise<boolean> {
  const db = ctx.env.DB;
  if (cmd === '/gruppen') {
    const groups = await evolution(ctx.env).fetchGroups();
    await reply(
      ctx,
      groups.length
        ? `Wähle mit /gruppe JID:\n${groups
            .slice(0, 30)
            .map((g) => `${g.subject}\n${g.id}`)
            .join('\n\n')}`
        : 'Der Bot ist noch in keiner Gruppe. Füge ihn zuerst der Trainingsgruppe hinzu.',
    );
    return true;
  }
  if (cmd === '/gruppe') {
    if (!args[0]) {
      await reply(ctx, 'Bitte /gruppe JID. Die verfügbaren Gruppen stehen unter /gruppen.');
      return true;
    }
    const g = (await evolution(ctx.env).fetchGroups()).find((g) => g.id === args[0]);
    if (!g) {
      await reply(ctx, 'Diese Gruppe gehört nicht zur Botinstanz.');
      return true;
    }
    await stage(
      ctx,
      {
        kind: 'group',
        group: g.id,
        name: g.subject,
        participants: g.participants.map((p) => p.id),
      },
      `Gruppe „${g.subject}“ für TT auswählen. Informiere die Gruppe vor Aktivierung über den Bot und seine Datenverarbeitung.`,
    );
    return true;
  }
  if (cmd === '/info' || cmd === '/datenschutz') {
    const text = ctx.text.slice(ctx.text.indexOf(' ') + 1).trim();
    if (!args.length) {
      await reply(ctx, await setting(db, cmd === '/info' ? 'info_text' : 'privacy_text'));
      return true;
    }
    if (text.length < 20 || text.length > 6000) {
      await reply(ctx, 'Bitte einen vollständigen Text zwischen 20 und 6000 Zeichen angeben.');
      return true;
    }
    await stage(
      ctx,
      { kind: 'setting', name: cmd === '/info' ? 'info_text' : 'privacy_text', value: text },
      `${cmd === '/info' ? 'Trainingsinformationen' : 'Datenschutzhinweise'} veröffentlichen:\n\n${text}`,
    );
    return true;
  }
  if (cmd === '/aktivieren' || cmd === '/deaktivieren') {
    if (
      cmd === '/aktivieren' &&
      (!(await chosenGroup(db)) || (await setting(db, 'privacy_ready')) !== '1')
    ) {
      await reply(
        ctx,
        'Vor der Aktivierung bitte eine Gruppe wählen und mit /datenschutz TEXT die Angaben zum Verantwortlichen und zur Verarbeitung einrichten.',
      );
      return true;
    }
    await stage(
      ctx,
      { kind: 'setting', name: 'enabled', value: cmd === '/aktivieren' ? '1' : '0' },
      cmd === '/aktivieren'
        ? 'Automatische Trainingsnachrichten aktivieren. Bestätige, dass die Gruppe über den Bot informiert ist.'
        : 'Automatische Trainingsnachrichten pausieren.',
    );
    return true;
  }
  if (cmd === '/status') {
    const counts = await all<{ status: string; n: number }>(
      db,
      'SELECT status,COUNT(*) AS n FROM outbox_jobs GROUP BY status',
    );
    const failures = await all<{ id: string; error: string; status: string }>(
      db,
      "SELECT id,error,status FROM outbox_jobs WHERE status IN ('failed','uncertain') ORDER BY created_at DESC LIMIT 5",
    );
    let connection = 'nicht erreichbar';
    try {
      connection = (await evolution(ctx.env).connectionState()).state;
    } catch {
      /* never expose API errors */
    }
    await reply(
      ctx,
      `Bot: ${connection}\nAutomatik: ${(await setting(db, 'enabled')) === '1' ? 'aktiv' : 'pausiert'}\nLetzter Schedulerlauf: ${await setting(db, 'last_cron', 'noch keiner')}\n${counts.map((c) => `${c.status}: ${c.n}`).join('\n')}\n${failures.map((f) => `${f.id} · ${f.status} · ${f.error}`).join('\n')}\nUnklare Sendungen vor Wiederholung auf WhatsApp prüfen. /nachricht ID wiederholen`,
    );
    return true;
  }
  if (cmd === '/nachricht') {
    if (args.length !== 2 || args[1] !== 'wiederholen') {
      await reply(
        ctx,
        'Verwendung: /nachricht ID wiederholen. Prüfe vorher, ob die Nachricht bereits in WhatsApp steht.',
      );
      return true;
    }
    const j = await db
      .prepare(
        "SELECT id FROM outbox_jobs WHERE id=? AND status IN ('failed','uncertain') AND expires_at>?",
      )
      .bind(args[0], ctx.now)
      .first();
    if (!j) {
      await reply(ctx, 'Keine noch gültige fehlgeschlagene oder unklare Nachricht mit dieser ID.');
      return true;
    }
    await stage(
      ctx,
      { kind: 'retry', id: args[0] },
      'Erneut senden? Bei unklarem vorherigem Versand kann das eine doppelte Nachricht erzeugen.',
    );
    return true;
  }
  if (cmd === '/termine') {
    await materialize(db, ctx.now, true);
    const group = await requireGroup(ctx);
    if (!group) return true;
    const rows = await upcoming(db, ctx.now, group);
    const series = await all<Series>(
      db,
      'SELECT * FROM training_series WHERE group_jid=? AND active=1',
      group,
    );
    await reply(
      ctx,
      `${
        rows
          .slice(0, 12)
          .map((t) => `${t.status === 'cancelled' ? '❌' : '🏓'} ${label(t)}\n${t.id}`)
          .join('\n\n') || 'Noch keine Termine. /training richtet eine Serie ein.'
      }\n\nSerien: ${series.map((s) => s.id).join(', ') || 'keine'}`,
    );
    return true;
  }
  if (cmd === '/ubersicht') {
    const t = await selectTraining(ctx, args[0]);
    if (!t) return true;
    const rows = await all<{
      display_name: string;
      response: string;
      punctuality: string;
      minutes: number | null;
      needs_confirmation: number;
    }>(
      db,
      'SELECT u.display_name,a.* FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.session_id=?',
      t.id,
    );
    const members = await db
      .prepare('SELECT COUNT(*) AS n FROM memberships WHERE group_jid=? AND active=1')
      .bind(t.group_jid)
      .first<{ n: number }>();
    await reply(
      ctx,
      `${label(t)}\n${rows.map((r) => `${r.response === 'yes' ? '👍' : r.response === 'no' ? '👎' : '❔'} ${r.display_name || 'Mitglied'}${r.punctuality === 'late' ? ` · ⏰ ${r.minutes ? `${r.minutes} Min.` : 'später'}` : ''}${r.needs_confirmation ? ' · erneut bestätigen' : ''}`).join('\n') || 'Noch keine Rückmeldungen.'}\nOffen: ${Math.max(0, (members?.n ?? 0) - rows.filter((r) => r.response !== 'unknown').length)}`,
    );
    return true;
  }
  if (cmd === '/training') {
    const group = await requireGroup(ctx);
    if (group) {
      await saveConversation(ctx, 'training:wizard', { group, step: 0, answers: [] });
      await reply(ctx, WIZARD_QUESTIONS[0]);
    }
    return true;
  }
  if (cmd === '/serie') {
    if (args[0] !== 'beenden' || !args[1]) {
      await reply(ctx, 'Verwendung: /serie beenden ID. Die IDs stehen unter /termine.');
      return true;
    }
    const s = await db
      .prepare('SELECT * FROM training_series WHERE id=? AND active=1')
      .bind(args[1])
      .first<Series>();
    if (!s) {
      await reply(ctx, 'Diese aktive Serie finde ich nicht.');
      return true;
    }
    await stage(
      ctx,
      { kind: 'endSeries', id: s.id },
      'Serie beenden und alle zukünftigen Termine absagen?',
    );
    return true;
  }
  if (cmd === '/ausfall') {
    const t = await selectTraining(ctx, args[0]);
    if (t)
      await stage(
        ctx,
        { kind: 'cancel', id: t.id, version: t.version },
        `Training absagen: ${label(t)}`,
      );
    return true;
  }
  if (cmd === '/pause') {
    if (args.length !== 2) {
      await reply(ctx, 'Verwendung: /pause JJJJ-MM-TT JJJJ-MM-TT');
      return true;
    }
    const from = parseDate(args[0]).toString(),
      to = parseDate(args[1]).toString();
    if (from > to) {
      await reply(ctx, 'Das Ende muss nach dem Beginn der Pause liegen.');
      return true;
    }
    const group = await requireGroup(ctx);
    if (group)
      await stage(
        ctx,
        { kind: 'pause', id: shortId(), group, from, to },
        `Alle Trainingsserien dieser Gruppe vom ${from} bis einschließlich ${to} pausieren?`,
      );
    return true;
  }
  if (cmd === '/verschieben') {
    if (args.length !== 3) {
      await reply(ctx, 'Verwendung: /verschieben TERMIN JJJJ-MM-TT HH:MM');
      return true;
    }
    const t = await selectTraining(ctx, args[0]);
    if (!t) return true;
    const times = movedTimes(t, args[1], args[2]);
    if (times.start <= ctx.now) {
      await reply(ctx, 'Der neue Beginn muss in der Zukunft liegen.');
      return true;
    }
    await stage(
      ctx,
      { kind: 'move', id: t.id, version: t.version, date: args[1], time: args[2] },
      `Verschieben auf ${label({ ...t, start_at: times.start, end_at: times.end })}? Bestehende Zusagen müssen erneut bestätigt werden.`,
    );
    return true;
  }
  if (cmd === '/sondertraining') {
    if (args.length < 3) {
      await reply(ctx, 'Verwendung: /sondertraining JJJJ-MM-TT HH:MM HH:MM ORT');
      return true;
    }
    const group = await requireGroup(ctx);
    if (!group) return true;
    const last = await db
      .prepare(
        'SELECT location FROM training_series WHERE group_jid=? ORDER BY created_at DESC LIMIT 1',
      )
      .bind(group)
      .first<{ location: string }>();
    const location = args.slice(3).join(' ') || last?.location;
    if (!location) {
      await reply(ctx, 'Bitte den Trainingsort ergänzen.');
      return true;
    }
    const o = occurrence({ weekday: 1, startTime: args[1], endTime: args[2] }, args[0]);
    const t: Training = {
      id: shortId(),
      series_id: null,
      group_jid: group,
      local_date: args[0],
      start_at: o.startAt,
      end_at: o.endAt,
      timezone: 'Europe/Berlin',
      location,
      invite_at: o.reminderAt,
      late_at: o.lateReminderAt,
      status: 'scheduled',
      version: 1,
      created_at: ctx.now,
    };
    if (t.start_at <= ctx.now) {
      await reply(ctx, 'Das Sondertraining muss in der Zukunft liegen.');
      return true;
    }
    await stage(ctx, { kind: 'special', training: t }, `Sondertraining anlegen: ${label(t)}`);
    return true;
  }
  return false;
}

interface AttendanceRow {
  response: string;
  punctuality: string;
  minutes: number | null;
  arrival_time: string | null;
  response_source: string | null;
  response_at: number;
  late_source: string | null;
  late_updated_at: number;
  updated_at: number;
  needs_confirmation: number;
}
function stateFromRow(row: AttendanceRow): AttendanceState {
  return {
    attendance: row.response as AttendanceState['attendance'],
    late: row.punctuality === 'late',
    minutes: row.minutes ?? undefined,
    attendanceStamp: row.response_source ? JSON.parse(row.response_source) : undefined,
    lateStamp: row.late_source ? JSON.parse(row.late_source) : undefined,
  };
}
function resolveArrival(intent: AttendanceIntent, training: Training): AttendanceIntent {
  if (!intent.arrivalTime) return intent;
  const arrival = localTimestamp(
    dateInZone(training.start_at, training.timezone),
    intent.arrivalTime,
    training.timezone,
  );
  if (arrival <= training.start_at)
    return { ...intent, kind: 'punctual', minutes: undefined, arrivalTime: undefined };
  const minutes = Math.ceil((arrival - training.start_at) / 60000);
  return { ...intent, minutes: minutes <= 240 ? minutes : undefined };
}

export async function recordAttendance(
  ctx: BotContext,
  t: Training,
  change: AttendanceChange,
  arrival?: string,
  notify = true,
): Promise<'updated' | 'unchanged' | 'unavailable' | 'forbidden'> {
  const db = ctx.env.DB;
  if (t.status !== 'scheduled' || t.end_at <= ctx.now) {
    if (notify) await reply(ctx, 'Dieser Termin ist abgesagt oder bereits beendet.');
    return 'unavailable';
  }
  const member = await db
    .prepare('SELECT user_id FROM memberships WHERE group_jid=? AND user_id=? AND active=1')
    .bind(t.group_jid, ctx.user.id)
    .first();
  if (!member) {
    if (notify)
      await reply(
        ctx,
        'Für diese Trainingsgruppe bist du noch nicht freigeschaltet. Melde dich beim Trainer.',
      );
    return 'forbidden';
  }
  await db
    .prepare('INSERT OR IGNORE INTO attendance(session_id,user_id,updated_at) VALUES(?,?,0)')
    .bind(t.id, ctx.user.id)
    .run();
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = (await db
      .prepare('SELECT * FROM attendance WHERE session_id=? AND user_id=?')
      .bind(t.id, ctx.user.id)
      .first<AttendanceRow>())!;
    const before = stateFromRow(row),
      after = reduceAttendance(before, change);
    if (JSON.stringify(before) === JSON.stringify(after)) return 'unchanged';
    const stamp = after.attendanceStamp;
    const lateStamp = after.lateStamp;
    const update = db
      .prepare(
        `UPDATE attendance SET response=?,punctuality=?,minutes=?,arrival_time=?,response_source=?,response_at=?,late_source=?,late_updated_at=?,needs_confirmation=0,updated_at=? WHERE session_id=? AND user_id=? AND updated_at=? AND EXISTS(SELECT 1 FROM training_sessions s JOIN memberships m ON m.group_jid=s.group_jid JOIN groups g ON g.jid=s.group_jid WHERE s.id=? AND s.version=? AND s.status='scheduled' AND s.end_at>? AND m.user_id=? AND m.active=1 AND g.active=1) AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')`,
      )
      .bind(
        after.attendance,
        after.late ? 'late' : lateStamp ? 'punctual' : 'unknown',
        after.minutes ?? null,
        after.late
          ? (arrival ??
              (JSON.stringify(after.lateStamp) === JSON.stringify(before.lateStamp)
                ? row.arrival_time
                : null))
          : null,
        stamp ? JSON.stringify(stamp) : null,
        stamp?.timestamp ?? 0,
        lateStamp ? JSON.stringify(lateStamp) : null,
        lateStamp?.timestamp ?? 0,
        Math.max(ctx.now, row.updated_at + 1),
        t.id,
        ctx.user.id,
        row.updated_at,
        t.id,
        t.version,
        ctx.now,
        ctx.user.id,
      );
    const statements = [update];
    if (notify) {
      const text =
        after.attendance === 'no'
          ? 'Deine Absage ist eingetragen.'
          : after.late
            ? `⏰ Eingetragen: ${arrival ? `Ankunft um ${arrival} Uhr` : after.minutes ? `ca. ${after.minutes} Minuten später` : 'du kommst später'}.`
            : after.attendance === 'yes'
              ? '👍 Du bist dabei.'
              : 'Deine Rückmeldung wurde zurückgenommen.';
      const date = new Intl.DateTimeFormat('de-DE', {
        timeZone: t.timezone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(t.start_at));
      const body = `${text}\nTraining am ${date} Uhr.`;
      // changes() refers to the immediately preceding optimistic UPDATE in this
      // transaction. A lost race cannot enqueue a misleading acknowledgement.
      // Choose private delivery from live consent, not the earlier user snapshot.
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at)
          SELECT ?,?,r.target,CASE WHEN r.target LIKE '%@g.us' THEN NULL ELSE r.id END,'reply',
            CASE WHEN r.target LIKE '%@g.us' THEN ? ELSE ? END,?,?,?
          FROM (SELECT u.id,CASE WHEN u.registered_at IS NOT NULL AND u.reminders=1
            AND (SELECT accepted FROM consents WHERE user_id=u.id AND purpose='reminders' ORDER BY created_at DESC,rowid DESC LIMIT 1)=1
            THEN u.jid ELSE ? END AS target FROM users u WHERE u.id=?) r WHERE changes()=1`,
          )
          .bind(
            crypto.randomUUID(),
            `attendance:${ctx.eventId}`,
            `${ctx.user.display_name || 'Mitglied'}: ${body}`,
            body,
            ctx.now,
            ctx.now + 3600000,
            ctx.now,
            ctx.chatJid,
            ctx.user.id,
          ),
      );
    }
    const result = await db.batch(statements);
    if (!result[0].meta.changes) {
      const valid = await db
        .prepare(
          "SELECT s.id FROM training_sessions s JOIN memberships m ON m.group_jid=s.group_jid JOIN groups g ON g.jid=s.group_jid WHERE s.id=? AND s.version=? AND s.status='scheduled' AND s.end_at>? AND m.user_id=? AND m.active=1 AND g.active=1 AND EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')",
        )
        .bind(t.id, t.version, ctx.now, ctx.user.id)
        .first();
      if (!valid) {
        if (notify)
          await reply(
            ctx,
            'Termin oder Berechtigung wurden inzwischen geändert. Bitte prüfe /termine.',
          );
        return 'unavailable';
      }
      continue;
    }
    return 'updated';
  }
  throw new Error('attendance_conflict');
}

export async function processMessage(
  env: Env,
  event: MessageEvent & { credentialHash?: string },
  now = Date.now(),
): Promise<void> {
  if (event.isGroup) {
    if (
      (await setting(env.DB, 'enabled')) !== '1' ||
      (await setting(env.DB, 'privacy_ready')) !== '1'
    )
      return;
    const group = await env.DB.prepare('SELECT jid FROM groups WHERE jid=? AND active=1')
      .bind(event.chatJid)
      .first();
    if (!group) return;
  }
  const user = await resolveUser(env, event.senderJid, event.aliases, event.displayName, now);
  if (!user) return;
  const ctx: BotContext = {
    env,
    user,
    chatJid: event.chatJid,
    isGroup: event.isGroup,
    text: event.text ?? '',
    eventId: event.id,
    timestamp: event.timestamp,
    now,
    origin: await setting(env.DB, 'origin'),
    credentialHash: event.credentialHash,
  };
  if (event.isGroup)
    await env.DB.prepare(
      'INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,1,?) ON CONFLICT(group_jid,user_id) DO UPDATE SET active=CASE WHEN excluded.updated_at>memberships.updated_at THEN 1 ELSE memberships.active END,updated_at=MAX(memberships.updated_at,excluded.updated_at)',
    )
      .bind(event.chatJid, user.id, event.timestamp)
      .run();
  if (event.reaction) {
    const target = await env.DB.prepare('SELECT * FROM messages WHERE id=? AND chat_jid=?')
      .bind(event.reaction.targetId, event.chatJid)
      .first<{
        session_id: string;
        session_version: number;
        kind: string;
        user_id: string | null;
      }>();
    if (!target?.session_id || (target.user_id && target.user_id !== user.id)) return;
    const t = await env.DB.prepare('SELECT * FROM training_sessions WHERE id=?')
      .bind(target.session_id)
      .first<Training>();
    if (!t) return;
    if (t.version !== target.session_version) {
      await reply(ctx, 'Dieser Termin wurde geändert. Bitte reagiere auf die aktuelle Einladung.');
      return;
    }
    const emoji = normalizeEmoji(event.reaction.emoji);
    const invitationTarget = ['invite', 'personal_invite'].includes(target.kind),
      lateTarget = ['late', 'personal_late'].includes(target.kind);
    if (!invitationTarget && !lateTarget) return;
    if (emoji !== '' && (invitationTarget ? !['👍', '👎', '⏰'].includes(emoji) : emoji !== '⏰'))
      return;
    const change: AttendanceChange = {
      id: event.id,
      timestamp: event.timestamp,
      source: 'reaction',
      targetId: event.reaction.targetId,
      remove: emoji === '',
      removeLatenessOnly: lateTarget,
    };
    if (invitationTarget && ['👍', '👎'].includes(emoji)) {
      change.attendance = emoji === '👍' ? 'yes' : 'no';
      change.clearOwnLateness = emoji === '👍';
    }
    if (emoji === '⏰') {
      change.late = true;
      change.attendance = 'yes';
    }
    // Group reactions already visibly acknowledge attendance. Do not flood the group
    // with an additional bot message for each tap or removed reaction.
    await recordAttendance(ctx, t, change, undefined, !event.isGroup);
    return;
  }
  if (!ctx.text.trim()) return;
  const natural = ctx.text.trim().startsWith('/') ? 'none' : chatIntent(ctx.text);
  if (!ctx.isGroup && natural === 'login') ctx.text = '/login';
  if (!ctx.isGroup && natural === 'stop') ctx.text = '/stop';
  const [raw, ...args] = ctx.text.trim().split(/\s+/),
    cmd = commandName(raw);
  if (cmd === '/hilfe' || cmd === '/help') {
    await reply(
      ctx,
      `Reagiere mit 👍 oder 👎 auf die Trainingseinladung. Schreib zum Beispiel „Ich komme 10 Minuten später“. Konto und Einstellungen: ${ctx.origin}/login`,
    );
    return;
  }
  if (!event.isGroup && cmd === '/abbrechen') {
    await env.DB.prepare('DELETE FROM conversations WHERE user_id=?').bind(user.id).run();
    await reply(ctx, 'Der offene Dialog wurde abgebrochen.');
    return;
  }
  // Account commands have their own roles and replay protection.
  const account = await handleAccountMessage(ctx);
  if (account !== null) {
    for (let i = 0; i < account.length; i++) await reply(ctx, account[i], i);
    return;
  }
  const questionAnswer = await answerTrainingQuestion(ctx);
  if (questionAnswer !== null) {
    await reply(ctx, questionAnswer);
    return;
  }
  const c = await conversation(ctx);
  if (!ctx.isGroup && /https:\/\/chat\.whatsapp\.com\//i.test(ctx.text)) {
    const links = ctx.text.match(/https:\/\/chat\.whatsapp\.com\/[^\s<>]+/gi) ?? [];
    if (links.length !== 1) {
      await reply(ctx, 'Bitte sende einen einzelnen WhatsApp-Gruppenlink.');
      return;
    }
    try {
      await requestGroupLink(env, user.id, links[0].replace(/[.,!]+$/, ''), now);
      await reply(
        ctx,
        `Die Gruppe wartet auf die ausdrückliche Freigabe im Trainerbereich: ${ctx.origin}/trainer`,
      );
    } catch {
      await reply(
        ctx,
        'Den Gruppenlink konnte ich gerade nicht vormerken. Prüfe den Link und versuche es später erneut.',
      );
    }
    return;
  }
  if (!ctx.isGroup && ['reminders', 'account', 'privacy', 'help', 'manage'].includes(natural)) {
    const role = await getRole(env.DB, user.id);
    const message =
      natural === 'privacy'
        ? `Datenschutz: ${ctx.origin}/datenschutz`
        : natural === 'help'
          ? `Reagiere auf die Trainingseinladung oder schreib „Ich komme 10 Minuten später“. ${role ? 'Training verwalten' : 'Konto und Erinnerungen'}: ${ctx.origin}/${role ? 'trainer' : 'konto'}`
          : `${role ? 'Termine, Gruppen und Benachrichtigungen verwaltest du im Trainerbereich' : 'Konto, persönliche Erinnerungen und deine Daten verwaltest du hier'}: ${ctx.origin}/${role ? 'trainer' : 'konto'}`;
    await reply(ctx, message);
    return;
  }
  if (c?.kind === 'language:choice' && /^\d{1,2}[.!]?$/.test(ctx.text.trim())) {
    const data = JSON.parse(c.data) as {
      ids: string[];
      versions: number[];
      chatJid: string;
      intent: AttendanceIntent;
      timestamp: number;
    };
    if (data.chatJid !== ctx.chatJid) return;
    if (ctx.timestamp <= data.timestamp) return;
    const selected = data.ids[Number(ctx.text.trim().replace(/[.!]/g, '')) - 1];
    if (!selected) {
      await reply(ctx, 'Bitte wähle eine Nummer aus der letzten Terminliste.');
      return;
    }
    const t = await env.DB.prepare('SELECT * FROM training_sessions WHERE id=?')
      .bind(selected)
      .first<Training>();
    if (t && t.version !== data.versions[data.ids.indexOf(selected)]) {
      await reply(
        ctx,
        'Der Termin wurde inzwischen geändert. Bitte sende deine Rückmeldung erneut.',
      );
      return;
    }
    if (t) {
      const selectedIntent = resolveArrival(data.intent, t);
      await recordAttendance(
        ctx,
        t,
        {
          id: event.id,
          timestamp: event.timestamp,
          source: 'private',
          attendance:
            selectedIntent.kind === 'no'
              ? 'no'
              : ['yes', 'late', 'punctual'].includes(selectedIntent.kind)
                ? 'yes'
                : undefined,
          late:
            selectedIntent.kind === 'late'
              ? true
              : selectedIntent.kind === 'punctual'
                ? false
                : undefined,
          minutes: selectedIntent.minutes,
        },
        selectedIntent.arrivalTime,
      );
    }
    await env.DB.prepare("DELETE FROM conversations WHERE user_id=? AND kind='language:choice'")
      .bind(user.id)
      .run();
    return;
  }
  if (
    !ctx.isGroup &&
    cmd === '/bestatigen' &&
    (await env.DB.prepare('SELECT 1 FROM command_receipts WHERE event_id=? AND user_id=?')
      .bind(ctx.eventId, user.id)
      .first())
  ) {
    await reply(
      ctx,
      'Deine Änderung wurde bereits übernommen. Mit /termine oder /status siehst du den aktuellen Stand.',
    );
    return;
  }
  if (await admin(ctx)) {
    if (cmd === '/bestatigen' && c?.kind === 'training:confirm') {
      await confirmOperation(ctx, JSON.parse(c.data), c);
      return;
    }
    if (c?.kind === 'training:wizard' && !cmd.startsWith('/')) {
      await wizard(ctx, c);
      return;
    }
    try {
      if (await adminCommand(ctx, cmd, args)) return;
    } catch (error) {
      if (error instanceof RangeError) {
        await reply(
          ctx,
          'Datum oder Uhrzeit sind ungültig oder an diesem Tag nicht eindeutig. Bitte verwende JJJJ-MM-TT und HH:MM.',
        );
        return;
      }
      // Provider failures are handled without exposing its URL, credentials or response body.
      if (['/gruppen', '/gruppe', '/status'].includes(cmd)) {
        await reply(ctx, 'Evolution ist gerade nicht erreichbar. Bitte versuche es später erneut.');
        return;
      }
      throw error;
    }
  }
  if (['/ja', '/nein', '/spat', '/spaet', '/punktlich', '/puenktlich'].includes(cmd)) {
    let ref = args[0],
      minutes: number | undefined;
    if (['/spat', '/spaet'].includes(cmd) && /^\d{1,3}$/.test(ref ?? '')) {
      minutes = Number(ref);
      ref = '';
    } else if (args[1]) minutes = Number(args[1]);
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)) {
      await reply(ctx, 'Bitte eine Verspätung zwischen 1 und 240 Minuten angeben.');
      return;
    }
    const t = await selectTraining(ctx, ref);
    if (!t) return;
    const isLate = ['/spat', '/spaet'].includes(cmd);
    await recordAttendance(ctx, t, {
      id: event.id,
      timestamp: event.timestamp,
      source: 'private',
      attendance: cmd === '/nein' ? 'no' : cmd === '/ja' || isLate ? 'yes' : undefined,
      late: isLate ? true : ['/punktlich', '/puenktlich'].includes(cmd) ? false : undefined,
      minutes,
    });
    return;
  }
  if (cmd.startsWith('/')) {
    if (!event.isGroup)
      await reply(
        ctx,
        `Das konnte ich nicht zuordnen oder dir fehlt die Berechtigung. Konto und Einstellungen: ${ctx.origin}/login`,
      );
    return;
  }
  const intent = attendanceIntent(ctx.text);
  if (intent.kind === 'none') return;
  if (event.quotedId && !intent.reference) {
    const quoted = await env.DB.prepare(
      'SELECT m.session_id,m.session_version,s.version,m.user_id FROM messages m JOIN training_sessions s ON s.id=m.session_id WHERE m.id=? AND m.chat_jid=?',
    )
      .bind(event.quotedId, ctx.chatJid)
      .first<{
        session_id: string;
        session_version: number;
        version: number;
        user_id: string | null;
      }>();
    if (quoted && (!quoted.user_id || quoted.user_id === user.id)) {
      if (quoted.version !== quoted.session_version) {
        await reply(
          ctx,
          'Dieser Termin wurde geändert. Bitte antworte auf die aktuelle Einladung.',
        );
        return;
      }
      intent.reference = quoted.session_id;
    }
  }
  const possible = (await upcoming(env.DB, now, event.isGroup ? event.chatJid : undefined)).filter(
    (t) =>
      t.status === 'scheduled' &&
      t.end_at > now &&
      (intent.reference
        ? t.id === intent.reference
        : intent.day
          ? dateInZone(t.start_at, t.timezone) ===
            parseDate(dateInZone(now, t.timezone))
              .add({ days: intent.day === 'tomorrow' ? 1 : 0 })
              .toString()
          : t.start_at - 36 * 3600000 <= now),
  );
  const mine = [] as Training[];
  for (const t of possible)
    if (
      await env.DB.prepare(
        'SELECT user_id FROM memberships WHERE group_jid=? AND user_id=? AND active=1',
      )
        .bind(t.group_jid, user.id)
        .first()
    )
      mine.push(t);
  if (intent.kind === 'uncertain') {
    await reply(
      ctx,
      'Bitte bestätige kurz, was du meinst: „Ich komme“, „Ich komme nicht“ oder „Ich komme später“. Noch wurde nichts geändert.',
    );
    return;
  }
  if (mine.length !== 1) {
    if (!mine.length)
      await reply(
        ctx,
        'Dazu finde ich kein passendes Training. Schreib „Wann ist Training?“ oder frag deinen Trainer.',
      );
    else {
      await saveConversation(ctx, 'language:choice', {
        ids: mine.slice(0, 6).map((t) => t.id),
        versions: mine.slice(0, 6).map((t) => t.version),
        chatJid: ctx.chatJid,
        intent,
        timestamp: ctx.timestamp,
      });
      await reply(
        ctx,
        `Welches Training meinst du? Antworte mit der Nummer.\n${mine
          .slice(0, 6)
          .map((t, i) => `${i + 1}. ${label(t)}`)
          .join('\n')}`,
      );
    }
    return;
  }
  Object.assign(intent, resolveArrival(intent, mine[0]));
  await recordAttendance(
    ctx,
    mine[0],
    {
      id: event.id,
      timestamp: event.timestamp,
      source: 'private',
      attendance:
        intent.kind === 'no'
          ? 'no'
          : ['yes', 'late', 'punctual'].includes(intent.kind)
            ? 'yes'
            : undefined,
      late: intent.kind === 'late' ? true : intent.kind === 'punctual' ? false : undefined,
      minutes: intent.minutes,
    },
    intent.arrivalTime,
  );
}
