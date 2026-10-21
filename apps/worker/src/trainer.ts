import { isPracticeGroup } from './practice';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { occurrence, parseDate, trainingDates } from '@tt/core';
import { getSession } from './auth';
import { observeBotGroup } from './group-requests';
import { all, setting } from './db';
import { evolution } from './outbox';
import { cancelSessions, notifyChange } from './bot';
import {
  dateInZone,
  label,
  materialize,
  movedTimes,
  shortId,
  type Training,
  type Series,
} from './training';
import { attendanceSnapshot, preference, type SummaryRow } from './trainer-summary';
import type { AppBindings, BotContext, User } from './types';

type TrainerBindings = AppBindings & { Variables: { trainer: User } };
type TrainerContext = Context<TrainerBindings>;
interface Exception {
  id: string;
  series_id: string;
  from_date: string;
  to_date: string;
  kind: string;
  version: number;
}
class TrainerError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409 = 409,
  ) {
    super(code);
  }
}
const id = z.string().min(1).max(100);
const groupId = z.string().regex(/^\d+(?:-\d+)?@g\.us$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      parseDate(value);
      return true;
    } catch {
      return false;
    }
  });
const version = z.number().int().positive();
const seriesFields = {
  weekday: z.number().int().min(1).max(7),
  startTime: clock,
  endTime: clock,
  location: z.string().trim().min(2).max(200),
  reminderTime: clock.default('18:00'),
  lateOffset: z.number().int().min(0).max(240).default(30),
};
const seriesInput = z.object({ groupJid: groupId, ...seriesFields }).strict();
const seriesEdit = z
  .object({
    version,
    weekday: seriesFields.weekday.optional(),
    startTime: clock.optional(),
    endTime: clock.optional(),
    location: seriesFields.location.optional(),
    reminderTime: clock.optional(),
    lateOffset: seriesFields.lateOffset.optional(),
  })
  .strict();
const sessionInput = z
  .object({
    groupJid: groupId,
    date,
    startTime: clock,
    endTime: clock,
    location: seriesFields.location,
    reminderTime: seriesFields.reminderTime,
    lateOffset: seriesFields.lateOffset,
  })
  .strict();
const sessionView = (t: Training) => ({
  id: t.id,
  seriesId: t.series_id,
  groupJid: t.group_jid,
  date: dateInZone(t.start_at, t.timezone),
  startAt: t.start_at,
  endAt: t.end_at,
  timezone: t.timezone,
  location: t.location,
  version: t.version,
  status: t.status,
});
const seriesView = (s: Series & { version: number }) => ({
  id: s.id,
  groupJid: s.group_jid,
  weekday: s.weekday,
  startTime: s.start_time,
  endTime: s.end_time,
  timezone: s.timezone,
  location: s.location,
  reminderTime: s.reminder_time,
  lateOffset: s.late_offset,
  active: !!s.active,
  version: s.version,
});
const exceptionView = (e: Exception) => ({
  id: e.id,
  seriesId: e.series_id,
  fromDate: e.from_date,
  toDate: e.to_date,
  kind: e.kind,
  version: e.version,
});
const groupView = (g: { jid: string; name: string; active: number }) => ({
  ...g,
  active: !!g.active,
});
async function input<T extends z.ZodType>(c: TrainerContext, schema: T): Promise<z.infer<T>> {
  const value = schema.safeParse(await c.req.json().catch(() => null));
  if (!value.success) throw new TrainerError('invalid_input', 400);
  return value.data;
}
async function context(c: TrainerContext): Promise<BotContext> {
  const now = Date.now();
  return {
    env: c.env,
    user: c.get('trainer'),
    chatJid: c.get('trainer').jid,
    isGroup: false,
    text: '',
    eventId: `trainer:${crypto.randomUUID()}`,
    timestamp: now,
    now,
    origin: await setting(c.env.DB, 'origin'),
  };
}
interface Guard {
  sql: string;
  values: (string | number)[];
}
const guard = (sql: string, ...values: (string | number)[]): Guard => ({ sql, values });
const sessionGuard = (sessions: Training[]): Guard =>
  guard(
    `NOT EXISTS(SELECT 1 FROM json_each(?) x LEFT JOIN training_sessions s ON s.id=json_extract(x.value,'$.id') WHERE s.id IS NULL OR s.version!=json_extract(x.value,'$.version') OR s.status!=json_extract(x.value,'$.status'))`,
    JSON.stringify(sessions.map((t) => ({ id: t.id, version: t.version, status: t.status }))),
  );
const activeGroup = (jid: string) =>
  guard('EXISTS(SELECT 1 FROM groups WHERE jid=? AND active=1)', jid);

/** Reusable atomic mutation boundary: role, optimistic versions, audit and durable changes commit together. */
export async function commitTrainerMutation(
  ctx: BotContext,
  action: string,
  statements: D1PreparedStatement[],
  guards: Guard[] = [],
): Promise<void> {
  const condition = [
    "EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role IN ('owner','admin'))",
    ...guards.map((g) => `(${g.sql})`),
  ].join(' AND ');
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `INSERT INTO command_receipts(event_id,user_id,created_at,guard) VALUES(?,?,?,CASE WHEN ${condition} THEN 1 ELSE 0 END)`,
      ).bind(ctx.eventId, ctx.user.id, ctx.now, ctx.user.id, ...guards.flatMap((g) => g.values)),
      ...statements,
      ctx.env.DB.prepare(
        'INSERT INTO audit_log(id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)',
      ).bind(crypto.randomUUID(), ctx.user.id, `trainer:${action}`, 'web', ctx.now),
    ]);
  } catch {
    throw new TrainerError('state_changed');
  }
}
async function training(c: TrainerContext): Promise<Training> {
  const t = await c.env.DB.prepare('SELECT * FROM training_sessions WHERE id=?')
    .bind(c.req.param('id'))
    .first<Training>();
  if (!t) throw new TrainerError('not_found', 404);
  return t;
}
function assertCurrent(t: Training, wanted: number, now: number) {
  if (t.version !== wanted || t.status !== 'scheduled' || t.end_at <= now)
    throw new TrainerError('session_changed');
}
function validateSeries(value: z.infer<typeof seriesInput>, now: number) {
  const spec = { ...value, lateReminderMinutes: value.lateOffset };
  const today = dateInZone(now),
    through = parseDate(today).add({ days: 42 }).toString();
  for (const day of trainingDates(spec, today, through)) occurrence(spec, day);
  return spec;
}
function staleJobs(ctx: BotContext, t: Training): D1PreparedStatement {
  return ctx.env.DB.prepare(
    "UPDATE outbox_jobs SET status='cancelled' WHERE session_id=? AND status IN ('pending','processing')",
  ).bind(t.id);
}
function exceptionLink(
  ctx: BotContext,
  exceptionId: string,
  t: Training,
  newVersion: number,
): D1PreparedStatement {
  return ctx.env.DB.prepare(
    'INSERT OR IGNORE INTO exception_sessions(exception_id,session_id,cancelled_version) VALUES(?,?,?)',
  ).bind(exceptionId, t.id, newVersion);
}

export function registerTrainerRoutes(app: Hono<AppBindings>): void {
  const router = new Hono<TrainerBindings>();
  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const session = await getSession(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!session.role) return c.json({ error: 'forbidden' }, 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = await setting(c.env.DB, 'origin');
      if (
        c.req.header('Origin') !== origin ||
        new URL(c.req.url).origin !== origin ||
        c.req.header('Sec-Fetch-Site') === 'cross-site'
      )
        return c.json({ error: 'origin_mismatch' }, 403);
    }
    c.set('trainer', session.user);
    await next();
  });
  router.onError((error, c) =>
    error instanceof TrainerError
      ? c.json({ error: error.code }, error.status)
      : error instanceof RangeError
        ? c.json({ error: 'invalid_calendar' }, 400)
        : c.json({ error: 'internal_error' }, 500),
  );

  router.get('/overview', async (c) => {
    const now = Date.now();
    await materialize(c.env.DB, now);
    const groups = await all<{ jid: string; name: string; active: number }>(
      c.env.DB,
      'SELECT jid,name,active FROM groups ORDER BY name',
    );
    const series = await all<Series & { version: number }>(
      c.env.DB,
      'SELECT * FROM training_series ORDER BY created_at DESC',
    );
    const sessions = await all<Training>(
      c.env.DB,
      'SELECT * FROM training_sessions WHERE end_at>? ORDER BY start_at LIMIT 200',
      now,
    );
    const exceptions = await all<Exception>(
      c.env.DB,
      'SELECT * FROM training_exceptions ORDER BY from_date DESC',
    );
    const p = await c.env.DB.prepare('SELECT * FROM trainer_summary_preferences WHERE user_id=?')
      .bind(c.get('trainer').id)
      .first<SummaryRow>();
    const enabled = (await setting(c.env.DB, 'enabled')) === '1',
      privacyReady = (await setting(c.env.DB, 'privacy_ready')) === '1';
    const jobs = await all<{
      kind: string;
      dueAt: number;
      sessionId: string | null;
      status: string;
    }>(
      c.env.DB,
      "SELECT kind,due_at AS dueAt,session_id AS sessionId,status FROM outbox_jobs WHERE status IN ('pending','failed','uncertain') AND expires_at>? AND kind!='reply' ORDER BY due_at LIMIT 30",
      now,
    );
    const scheduled = sessions
      .filter((t) => t.status === 'scheduled')
      .flatMap((t) => [
        ...(t.start_at > now
          ? [
              {
                kind: 'invite',
                dueAt: t.invite_at,
                sessionId: t.id,
                status: enabled && privacyReady ? 'scheduled' : 'paused',
              },
            ]
          : []),
        {
          kind: 'late',
          dueAt: t.late_at,
          sessionId: t.id,
          status: enabled && privacyReady ? 'scheduled' : 'paused',
        },
      ])
      .filter((x) => !jobs.some((j) => j.kind === x.kind && j.sessionId === x.sessionId));
    const counts = await all<{ status: string; n: number }>(
      c.env.DB,
      "SELECT status,COUNT(*) AS n FROM outbox_jobs WHERE status IN ('pending','failed','uncertain') GROUP BY status",
    );
    return c.json({
      settings: {
        origin: await setting(c.env.DB, 'origin'),
        infoText: await setting(c.env.DB, 'info_text'),
        privacyText: await setting(c.env.DB, 'privacy_text'),
        enabled,
        privacyReady,
        selectedGroup: await setting(c.env.DB, 'selected_group'),
      },
      groups: groups.map(groupView),
      series: series.map(seriesView),
      sessions: sessions.map(sessionView),
      exceptions: exceptions.map(exceptionView),
      userPreference: preference(p),
      delivery: {
        lastCron: (await setting(c.env.DB, 'last_cron')) || null,
        counts: {
          pending: counts.find((r) => r.status === 'pending')?.n ?? 0,
          failed: counts.find((r) => r.status === 'failed')?.n ?? 0,
          uncertain: counts.find((r) => r.status === 'uncertain')?.n ?? 0,
        },
        nextMessages: [...jobs, ...scheduled].sort((a, b) => a.dueAt - b.dueAt).slice(0, 30),
      },
    });
  });
  router.post('/groups/refresh', async (c) => {
    const ctx = await context(c),
      provider = evolution(c.env),
      fetched = await provider.fetchGroups();
    const groups: typeof fetched = [];
    for (const group of fetched)
      if (!(await isPracticeGroup(c.env.DB, group.id, group.subject))) groups.push(group);
    provider.fetchGroups = async () => groups; // One verified provider snapshot for this discovery pass.
    await commitTrainerMutation(
      ctx,
      'groups.refresh',
      groups.map((g) =>
        c.env.DB.prepare(
          'INSERT INTO groups(jid,name,active,created_at) VALUES(?,?,0,?) ON CONFLICT(jid) DO UPDATE SET name=excluded.name',
        ).bind(g.id, g.subject, ctx.now),
      ),
    );
    const stored = await all<{ jid: string; name: string; active: number }>(
      c.env.DB,
      'SELECT jid,name,active FROM groups',
    );
    for (const group of groups)
      if (!stored.find((s) => s.jid === group.id)?.active)
        await observeBotGroup(c.env, group.id, ctx.now, provider);
    return c.json({
      groups: groups.map((g) =>
        groupView({
          jid: g.id,
          name: g.subject,
          active: stored.find((s) => s.jid === g.id)?.active ?? 0,
        }),
      ),
    });
  });
  router.post('/groups/select', async (c) => {
    const value = await input(c, z.object({ jid: groupId, confirm: z.literal(true) }).strict()),
      ctx = await context(c);
    const group = await c.env.DB.prepare('SELECT jid FROM groups WHERE jid=? AND active=1')
      .bind(value.jid)
      .first<{ jid: string }>();
    if (!group) throw new TrainerError('group_approval_required');
    await commitTrainerMutation(
      ctx,
      'group.select',
      [
        c.env.DB.prepare(
          "INSERT INTO settings(key,value) VALUES('selected_group',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).bind(group.jid),
      ],
      [activeGroup(group.jid)],
    );
    return c.json({ ok: true, id: group.jid });
  });
  router.post('/series', async (c) => {
    const value = await input(c, seriesInput),
      ctx = await context(c);
    validateSeries(value, ctx.now);
    const seriesId = shortId();
    await commitTrainerMutation(
      ctx,
      'series.create',
      [
        c.env.DB.prepare(
          'INSERT INTO training_series(id,group_jid,weekday,start_time,end_time,location,reminder_time,late_offset,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        ).bind(
          seriesId,
          value.groupJid,
          value.weekday,
          value.startTime,
          value.endTime,
          value.location,
          value.reminderTime,
          value.lateOffset,
          ctx.now,
        ),
        c.env.DB.prepare("DELETE FROM settings WHERE key='materialized_date'"),
      ],
      [
        activeGroup(value.groupJid),
        guard(
          'NOT EXISTS(SELECT 1 FROM training_series WHERE group_jid=? AND weekday=? AND start_time=? AND active=1)',
          value.groupJid,
          value.weekday,
          value.startTime,
        ),
      ],
    );
    await materialize(c.env.DB, ctx.now, true);
    return c.json({ ok: true, id: seriesId, version: 1 }, 201);
  });
  router.patch('/series/:id', async (c) => {
    const value = await input(c, seriesEdit),
      ctx = await context(c);
    const old = await c.env.DB.prepare('SELECT * FROM training_series WHERE id=? AND active=1')
      .bind(c.req.param('id'))
      .first<Series & { version: number }>();
    if (!old) throw new TrainerError('not_found', 404);
    if (old.version !== value.version) throw new TrainerError('state_changed');
    const next = {
      groupJid: old.group_jid,
      weekday: value.weekday ?? old.weekday,
      startTime: value.startTime ?? old.start_time,
      endTime: value.endTime ?? old.end_time,
      location: value.location ?? old.location,
      reminderTime: value.reminderTime ?? old.reminder_time,
      lateOffset: value.lateOffset ?? old.late_offset,
    };
    const spec = validateSeries(next, ctx.now);
    const sessions = await all<Training>(
      c.env.DB,
      "SELECT * FROM training_sessions s WHERE series_id=? AND end_at>? AND (status='scheduled' OR EXISTS(SELECT 1 FROM exception_sessions e WHERE e.session_id=s.id AND e.cancelled_version=s.version)) ORDER BY start_at",
      old.id,
      ctx.now,
    );
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        'UPDATE training_series SET weekday=?,start_time=?,end_time=?,location=?,reminder_time=?,late_offset=?,version=version+1 WHERE id=? AND version=?',
      ).bind(
        next.weekday,
        next.startTime,
        next.endTime,
        next.location,
        next.reminderTime,
        next.lateOffset,
        old.id,
        old.version,
      ),
      c.env.DB.prepare("DELETE FROM settings WHERE key='materialized_date'"),
    ];
    for (const t of sessions) {
      const oldTime = occurrence(
        {
          weekday: old.weekday,
          startTime: old.start_time,
          endTime: old.end_time,
          reminderTime: old.reminder_time,
          lateReminderMinutes: old.late_offset,
        },
        t.local_date,
      );
      if (t.start_at !== oldTime.startAt || t.end_at !== oldTime.endAt) continue; // Preserve individually moved occurrences.
      const day = parseDate(t.local_date)
          .add({ days: next.weekday - old.weekday })
          .toString(),
        o = occurrence(spec, day);
      if (o.startAt <= ctx.now && t.status === 'scheduled') {
        statements.push(...cancelSessions(ctx, [t]));
        continue;
      }
      const moved = {
        ...t,
        local_date: day,
        start_at: o.startAt,
        end_at: o.endAt,
        invite_at: o.reminderAt,
        late_at: o.lateReminderAt,
        location: next.location,
        version: t.version + 1,
      };
      statements.push(
        c.env.DB.prepare(
          'UPDATE training_sessions SET local_date=?,start_at=?,end_at=?,invite_at=?,late_at=?,location=?,version=version+1 WHERE id=? AND version=?',
        ).bind(
          day,
          o.startAt,
          o.endAt,
          o.reminderAt,
          o.lateReminderAt,
          next.location,
          t.id,
          t.version,
        ),
        c.env.DB.prepare('UPDATE attendance SET needs_confirmation=1 WHERE session_id=?').bind(
          t.id,
        ),
        staleJobs(ctx, t),
      );
      if (t.status === 'cancelled')
        statements.push(
          c.env.DB.prepare(
            "UPDATE training_exceptions SET from_date=?,to_date=?,version=version+1 WHERE kind='cancel' AND id IN (SELECT exception_id FROM exception_sessions WHERE session_id=? AND cancelled_version=?)",
          ).bind(day, day, t.id, t.version),
          c.env.DB.prepare(
            'UPDATE exception_sessions SET cancelled_version=? WHERE session_id=? AND cancelled_version=?',
          ).bind(t.version + 1, t.id, t.version),
        );
      else
        statements.push(
          ...notifyChange(
            ctx,
            moved,
            `↪️ *Trainingsserie geändert*\n${label(moved)}\nBitte Teilnahme erneut bestätigen.`,
            true,
          ),
        );
    }
    await commitTrainerMutation(ctx, 'series.edit', statements, [
      guard(
        'EXISTS(SELECT 1 FROM training_series WHERE id=? AND version=? AND active=1)',
        old.id,
        old.version,
      ),
      sessionGuard(sessions),
      guard(
        "(SELECT COUNT(*) FROM training_sessions s WHERE series_id=? AND end_at>? AND (status='scheduled' OR EXISTS(SELECT 1 FROM exception_sessions e WHERE e.session_id=s.id AND e.cancelled_version=s.version)))=?",
        old.id,
        ctx.now,
        sessions.length,
      ),
    ]);
    await materialize(c.env.DB, ctx.now, true);
    return c.json({ ok: true, id: old.id, version: old.version + 1 });
  });
  router.post('/series/:id/end', async (c) => {
    const value = await input(c, z.object({ version }).strict()),
      ctx = await context(c);
    const sessions = await all<Training>(
      c.env.DB,
      "SELECT * FROM training_sessions WHERE series_id=? AND end_at>? AND status='scheduled'",
      c.req.param('id'),
      ctx.now,
    );
    await commitTrainerMutation(
      ctx,
      'series.end',
      [
        c.env.DB.prepare(
          'UPDATE training_series SET active=0,version=version+1 WHERE id=? AND version=?',
        ).bind(c.req.param('id'), value.version),
        ...cancelSessions(ctx, sessions),
      ],
      [
        guard(
          'EXISTS(SELECT 1 FROM training_series WHERE id=? AND version=? AND active=1)',
          c.req.param('id'),
          value.version,
        ),
        sessionGuard(sessions),
        guard(
          "(SELECT COUNT(*) FROM training_sessions WHERE series_id=? AND end_at>? AND status='scheduled')=?",
          c.req.param('id'),
          ctx.now,
          sessions.length,
        ),
      ],
    );
    return c.json({ ok: true, version: value.version + 1 });
  });
  router.post('/sessions', async (c) => {
    const value = await input(c, sessionInput),
      ctx = await context(c),
      o = occurrence({ weekday: 1, ...value, lateReminderMinutes: value.lateOffset }, value.date);
    if (o.startAt <= ctx.now) throw new TrainerError('past_training', 400);
    const sessionId = shortId();
    await commitTrainerMutation(
      ctx,
      'session.create',
      [
        c.env.DB.prepare(
          "INSERT INTO training_sessions(id,group_jid,local_date,start_at,end_at,timezone,location,invite_at,late_at,created_at) VALUES(?,?,?,?,?,'Europe/Berlin',?,?,?,?)",
        ).bind(
          sessionId,
          value.groupJid,
          value.date,
          o.startAt,
          o.endAt,
          value.location,
          o.reminderAt,
          o.lateReminderAt,
          ctx.now,
        ),
      ],
      [
        activeGroup(value.groupJid),
        guard(
          "NOT EXISTS(SELECT 1 FROM training_sessions WHERE group_jid=? AND start_at=? AND status='scheduled')",
          value.groupJid,
          o.startAt,
        ),
      ],
    );
    return c.json({ ok: true, id: sessionId, version: 1 }, 201);
  });
  router.post('/sessions/:id/move', async (c) => {
    const value = await input(c, z.object({ version, date, startTime: clock }).strict()),
      ctx = await context(c),
      t = await training(c);
    assertCurrent(t, value.version, ctx.now);
    const times = movedTimes(t, value.date, value.startTime);
    if (times.start <= ctx.now) throw new TrainerError('past_training', 400);
    const moved = {
      ...t,
      start_at: times.start,
      end_at: times.end,
      invite_at: times.invite,
      late_at: times.late,
      version: t.version + 1,
    };
    await commitTrainerMutation(
      ctx,
      'session.move',
      [
        c.env.DB.prepare(
          'UPDATE training_sessions SET start_at=?,end_at=?,invite_at=?,late_at=?,version=version+1 WHERE id=? AND version=?',
        ).bind(times.start, times.end, times.invite, times.late, t.id, t.version),
        c.env.DB.prepare('UPDATE attendance SET needs_confirmation=1 WHERE session_id=?').bind(
          t.id,
        ),
        staleJobs(ctx, t),
        ...notifyChange(
          ctx,
          moved,
          `↪️ Training verschoben\n${label(moved)}\nBitte Teilnahme erneut bestätigen.`,
          true,
        ),
      ],
      [sessionGuard([t]), activeGroup(t.group_jid)],
    );
    return c.json({ ok: true, id: t.id, version: t.version + 1 });
  });
  router.post('/sessions/:id/cancel', async (c) => {
    const value = await input(c, z.object({ version }).strict()),
      ctx = await context(c),
      t = await training(c);
    assertCurrent(t, value.version, ctx.now);
    const statements: D1PreparedStatement[] = [];
    if (t.series_id) {
      const exceptionId = `cancel:${t.id}`;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO training_exceptions(id,series_id,from_date,to_date,kind,created_at) VALUES(?,?,?,?,'cancel',?)",
        ).bind(exceptionId, t.series_id, t.local_date, t.local_date, ctx.now),
        exceptionLink(ctx, exceptionId, t, t.version + 1),
      );
    }
    statements.push(...cancelSessions(ctx, [t]));
    await commitTrainerMutation(ctx, 'session.cancel', statements, [sessionGuard([t])]);
    return c.json({ ok: true, id: t.id, version: t.version + 1 });
  });
  router.post('/pauses', async (c) => {
    const value = await input(
        c,
        z.object({ groupJid: groupId, fromDate: date, toDate: date }).strict(),
      ),
      ctx = await context(c);
    if (
      value.fromDate > value.toDate ||
      parseDate(value.fromDate).until(parseDate(value.toDate)).days > 366
    )
      throw new TrainerError('invalid_range', 400);
    const rows = await all<Series & { version: number }>(
      c.env.DB,
      'SELECT * FROM training_series WHERE group_jid=? AND active=1',
      value.groupJid,
    );
    if (!rows.length) throw new TrainerError('no_series', 400);
    const sessions = await all<Training>(
      c.env.DB,
      'SELECT * FROM training_sessions WHERE group_jid=? AND series_id IS NOT NULL AND local_date>=? AND local_date<=? AND end_at>?',
      value.groupJid,
      value.fromDate,
      value.toDate,
      ctx.now,
    );
    const scheduled = sessions.filter((t) => t.status === 'scheduled'),
      statements: D1PreparedStatement[] = [],
      pauseId = shortId();
    for (const row of rows) {
      const exceptionId = `${pauseId}:${row.id}`;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO training_exceptions(id,series_id,from_date,to_date,kind,created_at) VALUES(?,?,?,?,'pause',?)",
        ).bind(exceptionId, row.id, value.fromDate, value.toDate, ctx.now),
      );
      for (const t of sessions.filter((t) => t.series_id === row.id))
        statements.push(
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO exception_sessions(exception_id,session_id,cancelled_version) SELECT ?,?,? WHERE ?='scheduled' OR EXISTS(SELECT 1 FROM exception_sessions WHERE session_id=?)`,
          ).bind(
            exceptionId,
            t.id,
            t.status === 'scheduled' ? t.version + 1 : t.version,
            t.status,
            t.id,
          ),
        );
    }
    statements.push(...cancelSessions(ctx, scheduled));
    await commitTrainerMutation(ctx, 'pause.create', statements, [
      activeGroup(value.groupJid),
      sessionGuard(sessions),
      guard(
        'EXISTS(SELECT 1 FROM training_series WHERE group_jid=? AND active=1) AND (SELECT COUNT(*) FROM training_series WHERE group_jid=? AND active=1)=?',
        value.groupJid,
        value.groupJid,
        rows.length,
      ),
      guard(
        '(SELECT COUNT(*) FROM training_sessions WHERE group_jid=? AND series_id IS NOT NULL AND local_date>=? AND local_date<=? AND end_at>?)=?',
        value.groupJid,
        value.fromDate,
        value.toDate,
        ctx.now,
        sessions.length,
      ),
      guard(
        "NOT EXISTS(SELECT 1 FROM json_each(?) x LEFT JOIN training_series s ON s.id=json_extract(x.value,'$.id') WHERE s.id IS NULL OR s.active!=1 OR s.version!=json_extract(x.value,'$.version'))",
        JSON.stringify(rows.map((s) => ({ id: s.id, version: s.version }))),
      ),
    ]);
    return c.json({ ok: true, id: pauseId }, 201);
  });
  router.get('/exceptions', async (c) =>
    c.json({
      exceptions: (
        await all<Exception>(c.env.DB, 'SELECT * FROM training_exceptions ORDER BY from_date DESC')
      ).map(exceptionView),
    }),
  );
  router.delete('/exceptions/:id', async (c) => {
    const value = await input(c, z.object({ version }).strict()),
      ctx = await context(c),
      exception = await c.env.DB.prepare('SELECT * FROM training_exceptions WHERE id=?')
        .bind(c.req.param('id'))
        .first<Exception>();
    if (!exception) throw new TrainerError('not_found', 404);
    if (exception.version !== value.version) throw new TrainerError('state_changed');
    const affected = await all<Training & { cancelled_version: number }>(
      c.env.DB,
      'SELECT s.*,e.cancelled_version FROM training_sessions s JOIN exception_sessions e ON e.session_id=s.id WHERE e.exception_id=?',
      exception.id,
    );
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare('DELETE FROM training_exceptions WHERE id=? AND version=?').bind(
        exception.id,
        value.version,
      ),
      c.env.DB.prepare("DELETE FROM settings WHERE key='materialized_date'"),
    ];
    for (const t of affected) {
      if (t.status !== 'cancelled' || t.version !== t.cancelled_version || t.end_at <= ctx.now)
        continue;
      const restored = { ...t, status: 'scheduled' as const, version: t.version + 1 };
      statements.push(
        c.env.DB.prepare(
          `UPDATE training_sessions SET status='scheduled',version=version+1 WHERE id=? AND version=? AND status='cancelled' AND EXISTS(SELECT 1 FROM training_series WHERE id=training_sessions.series_id AND active=1) AND NOT EXISTS(SELECT 1 FROM training_exceptions WHERE series_id=training_sessions.series_id AND from_date<=training_sessions.local_date AND to_date>=training_sessions.local_date) AND NOT EXISTS(SELECT 1 FROM exception_sessions WHERE session_id=training_sessions.id)`,
        ).bind(t.id, t.version),
        c.env.DB.prepare(
          "UPDATE attendance SET needs_confirmation=1 WHERE session_id=? AND EXISTS(SELECT 1 FROM training_sessions WHERE id=? AND status='scheduled' AND version=?)",
        ).bind(t.id, t.id, t.version + 1),
        c.env.DB.prepare(
          "UPDATE outbox_jobs SET status='cancelled' WHERE session_id=? AND session_version!=? AND status IN ('pending','processing')",
        ).bind(t.id, t.version + 1),
        ...notifyChange(
          ctx,
          restored,
          `🏓 *Training findet wieder statt*\n${label(restored)}\nBitte Teilnahme erneut bestätigen.`,
          true,
        ),
      );
    }
    await commitTrainerMutation(ctx, 'exception.remove', statements, [
      guard(
        'EXISTS(SELECT 1 FROM training_exceptions WHERE id=? AND version=?)',
        exception.id,
        value.version,
      ),
      sessionGuard(affected),
    ]);
    await materialize(c.env.DB, ctx.now, true);
    return c.json({ ok: true });
  });
  // Historical corrections are optional; an uncorrected session uses its RSVP.
  router.get('/history', async (c) => {
    const offset = Number(c.req.query('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw new TrainerError('invalid_input', 400);
    const now = Date.now();
    const rows = await all<Training>(
      c.env.DB,
      `SELECT s.* FROM training_sessions s WHERE s.end_at<=? AND s.end_at>=?
       AND s.status='scheduled' AND NOT EXISTS(SELECT 1 FROM practice_groups p WHERE p.group_jid=s.group_jid)
       ORDER BY s.end_at DESC,s.id LIMIT 51 OFFSET ?`,
      now,
      now - 400 * 86400000,
      offset,
    );
    return c.json({
      sessions: rows.slice(0, 50).map(sessionView),
      nextOffset: rows.length > 50 ? offset + 50 : null,
    });
  });
  const historicalTraining = async (c: TrainerContext) => {
    const t = await training(c);
    if (
      t.status !== 'scheduled' ||
      t.end_at > Date.now() ||
      t.end_at < Date.now() - 400 * 86400000 ||
      (await isPracticeGroup(c.env.DB, t.group_jid))
    )
      throw new TrainerError('session_changed');
    return t;
  };
  router.get('/sessions/:id/presence', async (c) => {
    const t = await historicalTraining(c);
    const bot = (await setting(c.env.DB, 'bot_jid')) ?? '';
    const rows = await all<{
      userId: string;
      name: string;
      response: string;
      needsConfirmation: number;
      state: string;
      updatedAt: number;
      editable: number;
    }>(
      c.env.DB,
      `SELECT u.id AS userId,u.display_name AS name,COALESCE(a.response,'unknown') AS response,
       COALESCE(a.needs_confirmation,0) AS needsConfirmation,COALESCE(p.state,'automatic') AS state,COALESCE(p.updated_at,0) AS updatedAt,EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.group_jid=? AND m.active=1) AS editable
       FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.session_id=?
       LEFT JOIN session_presence p ON p.user_id=u.id AND p.session_id=?
       WHERE (a.user_id IS NOT NULL OR p.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.group_jid=? AND m.active=1))
       AND u.jid!=? AND NOT EXISTS(SELECT 1 FROM identity_aliases b WHERE b.user_id=u.id AND b.jid=?)
       ORDER BY u.display_name,u.id`,
      t.group_jid,
      t.id,
      t.id,
      t.group_jid,
      bot,
      bot,
    );
    return c.json({
      session: sessionView(t),
      participants: rows.map((r) => ({
        ...r,
        name: r.name.trim() || 'Mitglied · ' + r.userId.slice(0, 4),
        needsConfirmation: !!r.needsConfirmation,
      })),
    });
  });
  router.post('/sessions/:id/presence/:userId', async (c) => {
    const value = await input(
      c,
      z
        .object({
          sessionVersion: version,
          expectedUpdatedAt: z.number().int().nonnegative(),
          state: z.enum(['automatic', 'present', 'absent']),
        })
        .strict(),
    );
    const ctx = await context(c),
      t = await historicalTraining(c),
      userId = c.req.param('userId');
    if (t.version !== value.sessionVersion) throw new TrainerError('session_changed');
    const bot = (await setting(c.env.DB, 'bot_jid')) ?? '';
    await commitTrainerMutation(
      ctx,
      'presence.correct',
      [
        c.env.DB.prepare(
          `INSERT INTO session_presence(session_id,user_id,state,updated_at,confirmed_by) VALUES(?,?,?,?,?)
       ON CONFLICT(session_id,user_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,confirmed_by=excluded.confirmed_by`,
        ).bind(
          t.id,
          userId,
          value.state,
          Math.max(ctx.now, value.expectedUpdatedAt + 1),
          ctx.user.id,
        ),
      ],
      [
        sessionGuard([t]),
        guard(
          `EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.jid!=? AND NOT EXISTS(SELECT 1 FROM identity_aliases b WHERE b.user_id=u.id AND b.jid=?)
       AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.group_jid=? AND m.active=1))`,
          userId,
          bot,
          bot,
          t.group_jid,
        ),
        guard(`NOT EXISTS(SELECT 1 FROM practice_groups WHERE group_jid=?)`, t.group_jid),
        guard(
          'COALESCE((SELECT updated_at FROM session_presence WHERE session_id=? AND user_id=?),0)=?',
          t.id,
          userId,
          value.expectedUpdatedAt,
        ),
      ],
    );
    return c.json({ ok: true });
  });

  router.get('/sessions/:id/attendance', async (c) => {
    const t = await training(c);
    return c.json({ session: sessionView(t), ...(await attendanceSnapshot(c.env.DB, t)) });
  });
  router.post('/sessions/:id/attendance/:userId', async (c) => {
    const value = await input(
        c,
        z
          .object({
            sessionVersion: version,
            expectedUpdatedAt: z.number().int().nonnegative(),
            response: z.enum(['yes', 'no', 'late', 'punctual', 'unknown']),
            minutes: z.number().int().min(1).max(240).optional(),
          })
          .strict(),
      ),
      ctx = await context(c),
      t = await training(c);
    if (t.version !== value.sessionVersion) throw new TrainerError('session_changed');
    const userId = c.req.param('userId'),
      old = await c.env.DB.prepare('SELECT * FROM attendance WHERE session_id=? AND user_id=?')
        .bind(t.id, userId)
        .first<{ response: string; punctuality: string; updated_at: number }>();
    if ((old?.updated_at ?? 0) !== value.expectedUpdatedAt)
      throw new TrainerError('attendance_changed');
    const response =
        value.response === 'late'
          ? 'yes'
          : value.response === 'punctual'
            ? (old?.response ?? 'unknown')
            : value.response,
      punctuality =
        value.response === 'late' ? 'late' : value.response === 'punctual' ? 'punctual' : 'unknown';
    const stamp = JSON.stringify({ id: ctx.eventId, timestamp: ctx.now, source: 'private' });
    await commitTrainerMutation(
      ctx,
      'attendance.correct',
      [
        c.env.DB.prepare(
          `INSERT INTO attendance(session_id,user_id,response,punctuality,minutes,response_source,response_at,late_source,late_updated_at,needs_confirmation,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(session_id,user_id) DO UPDATE SET response=excluded.response,punctuality=excluded.punctuality,minutes=excluded.minutes,arrival_time=NULL,response_source=excluded.response_source,response_at=excluded.response_at,late_source=excluded.late_source,late_updated_at=excluded.late_updated_at,needs_confirmation=0,updated_at=excluded.updated_at`,
        ).bind(
          t.id,
          userId,
          response,
          punctuality,
          value.response === 'late' ? (value.minutes ?? null) : null,
          stamp,
          ctx.now,
          stamp,
          ctx.now,
          Math.max(ctx.now, value.expectedUpdatedAt + 1),
        ),
      ],
      [
        sessionGuard([t]),
        guard(
          'EXISTS(SELECT 1 FROM memberships WHERE group_jid=? AND user_id=? AND active=1)',
          t.group_jid,
          userId,
        ),
        guard(
          'COALESCE((SELECT updated_at FROM attendance WHERE session_id=? AND user_id=?),0)=?',
          t.id,
          userId,
          value.expectedUpdatedAt,
        ),
      ],
    );
    return c.json({ ok: true });
  });
  router.put('/settings', async (c) => {
    const value = await input(
        c,
        z
          .object({
            infoText: z.string().trim().min(20).max(6000).optional(),
            privacyText: z.string().trim().min(20).max(6000).optional(),
            enabled: z.boolean().optional(),
            confirm: z.literal(true),
          })
          .strict(),
      ),
      ctx = await context(c),
      statements: D1PreparedStatement[] = [],
      guards: Guard[] = [];
    for (const [key, text] of [
      ['info_text', value.infoText],
      ['privacy_text', value.privacyText],
      ['enabled', value.enabled === undefined ? undefined : value.enabled ? '1' : '0'],
    ] as const)
      if (text !== undefined)
        statements.push(
          c.env.DB.prepare(
            'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          ).bind(key, text),
        );
    if (value.privacyText)
      statements.push(c.env.DB.prepare("UPDATE settings SET value='1' WHERE key='privacy_ready'"));
    if (value.enabled === true) {
      if (!value.privacyText && (await setting(c.env.DB, 'privacy_ready')) !== '1')
        throw new TrainerError('privacy_required');
      const selected = await c.env.DB.prepare(
        "SELECT jid FROM groups WHERE jid=(SELECT value FROM settings WHERE key='selected_group') AND active=1",
      ).first();
      if (!selected) throw new TrainerError('group_approval_required');
      guards.push(
        guard(
          "EXISTS(SELECT 1 FROM groups WHERE jid=(SELECT value FROM settings WHERE key='selected_group') AND active=1)",
        ),
      );
      if (!value.privacyText)
        guards.push(
          guard("EXISTS(SELECT 1 FROM settings WHERE key='privacy_ready' AND value='1')"),
        );
      statements.push(
        c.env.DB.prepare(
          `UPDATE outbox_jobs SET status='pending' WHERE status='cancelled' AND attempts=0 AND lease_token IS NULL AND expires_at>? AND due_at>? AND kind IN ('invite','late','personal_invite','personal_late') AND EXISTS(SELECT 1 FROM training_sessions s JOIN groups g ON g.jid=s.group_jid WHERE s.id=outbox_jobs.session_id AND s.version=outbox_jobs.session_version AND s.status='scheduled' AND g.active=1)`,
        ).bind(ctx.now, ctx.now),
      );
    }
    if (value.enabled === false)
      statements.push(
        c.env.DB.prepare(
          "UPDATE outbox_jobs SET status='cancelled' WHERE session_id IS NOT NULL AND status IN ('pending','processing')",
        ),
      );
    await commitTrainerMutation(ctx, 'settings.update', statements, guards);
    return c.json({ ok: true });
  });
  router.put('/summary-preference', async (c) => {
    const value = await input(
        c,
        z
          .object({
            enabled: z.boolean(),
            offsetMinutes: z.number().int().min(0).max(120),
            includeAbsent: z.boolean(),
            includeLate: z.boolean(),
            includeCounts: z.boolean(),
            version: z.number().int().nonnegative(),
          })
          .strict(),
      ),
      ctx = await context(c);
    await commitTrainerMutation(
      ctx,
      'summary.preference',
      [
        c.env.DB.prepare(
          `INSERT INTO trainer_summary_preferences(user_id,enabled,offset_minutes,include_absent,include_late,include_counts,version,updated_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,offset_minutes=excluded.offset_minutes,include_absent=excluded.include_absent,include_late=excluded.include_late,include_counts=excluded.include_counts,version=trainer_summary_preferences.version+1,updated_at=excluded.updated_at`,
        ).bind(
          ctx.user.id,
          Number(value.enabled),
          value.offsetMinutes,
          Number(value.includeAbsent),
          Number(value.includeLate),
          Number(value.includeCounts),
          ctx.now,
        ),
        c.env.DB.prepare(
          "INSERT INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES(?,?,'trainer_summary','1',?,?,?)",
        ).bind(crypto.randomUUID(), ctx.user.id, Number(value.enabled), ctx.eventId, ctx.now),
        c.env.DB.prepare(
          "UPDATE outbox_jobs SET status='cancelled' WHERE user_id=? AND kind='trainer_summary' AND status IN ('pending','processing')",
        ).bind(ctx.user.id),
      ],
      [
        guard(
          'COALESCE((SELECT version FROM trainer_summary_preferences WHERE user_id=?),0)=?',
          ctx.user.id,
          value.version,
        ),
      ],
    );
    return c.json({
      ok: true,
      version: value.version + 1,
      userPreference: { ...value, version: value.version + 1 },
    });
  });
  router.all('*', (c) => c.json({ error: 'not_found' }, 404));
  app.route('/api/v1/trainer', router);
}
