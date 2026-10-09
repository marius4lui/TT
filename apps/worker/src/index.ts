import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppBindings, Env } from './types';
import { registerAuthRoutes, getSession } from './auth';
import { consumeRateLimit, hashToken, timingSafeEqual } from './security';
import { setting, setSetting, all } from './db';
import { acceptWebhook, cleanup, drainInbox } from './inbox';
import { planJobs, sendOutbox } from './outbox';
import { recordAttendance } from './bot';
import { label, type Training } from './training';
import { renderPage } from './pages';
import { registerTrainerRoutes } from './trainer';
import { registerGroupRequestRoutes } from './group-requests';
import { planTrainerSummaries } from './trainer-summary';

export const app = new Hono<AppBindings>();
app.use(
  '*',
  bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'body_too_large' }, 413) }),
);
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (new URL(c.req.url).protocol === 'https:')
    c.header('Strict-Transport-Security', 'max-age=31536000');
  if (c.req.path.startsWith('/api/') || ['/login', '/konto', '/trainer'].includes(c.req.path))
    c.header('Cache-Control', 'no-store');
  if (c.req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const allowed = await setting(c.env.DB, 'origin', 'https://tt.bz3.eu');
    if (c.req.header('Origin') !== allowed) return c.json({ error: 'origin_mismatch' }, 403);
    if (c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ error: 'origin_mismatch' }, 403);
  }
  await next();
});
app.onError((_error, c) => c.json({ error: 'internal_error' }, 500));
app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok', service: 'TT' });
  } catch {
    return c.json({ status: 'unavailable' }, 503);
  }
});
app.post('/webhooks/evolution', async (c) => {
  const expected = await setting(c.env.DB, 'webhook_token_hash');
  if (!/^[a-f0-9]{64}$/.test(expected)) return c.json({ error: 'not_configured' }, 503);
  const auth = c.req.header('Authorization') ?? '';
  if (
    !auth.startsWith('Bearer ') ||
    auth.length > 512 ||
    !timingSafeEqual(await hashToken(auth.slice(7)), expected)
  )
    return c.json({ error: 'unauthorized' }, 401);
  if (!(await consumeRateLimit(c.env.DB, 'webhooks', 300, 60000, Date.now())))
    return c.json({ error: 'rate_limit' }, 429);
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as { instance?: unknown }).instance !== c.env.EVOLUTION_INSTANCE
  )
    return c.json({ error: 'wrong_instance' }, 403);
  const accepted = await acceptWebhook(c.env, payload);
  // Durable insert finishes before acknowledging Evolution. Cron resumes any interrupted work.
  c.executionCtx.waitUntil(
    drainInbox(c.env)
      .then(() => sendOutbox(c.env))
      .catch(() => undefined),
  );
  return c.json({ accepted }, 202);
});
registerAuthRoutes(app);
registerGroupRequestRoutes(app);
registerTrainerRoutes(app);
app.get('/api/v1/sessions', async (c) => {
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const sql = session.role
    ? 'SELECT * FROM training_sessions WHERE end_at>? ORDER BY start_at LIMIT 50'
    : 'SELECT s.* FROM training_sessions s JOIN memberships m ON m.group_jid=s.group_jid WHERE m.user_id=? AND m.active=1 AND s.end_at>? ORDER BY s.start_at LIMIT 50';
  const rows = session.role
    ? await all<Training>(c.env.DB, sql, Date.now())
    : await all<Training>(c.env.DB, sql, session.user.id, Date.now());
  return c.json({
    sessions: rows.map((t) => ({
      id: t.id,
      label: label(t),
      startAt: t.start_at,
      endAt: t.end_at,
      status: t.status,
      version: t.version,
    })),
  });
});
const attendanceInput = z
  .object({
    response: z.enum(['yes', 'no', 'late', 'punctual']),
    minutes: z.number().int().min(1).max(240).optional(),
    version: z.number().int().positive(),
  })
  .strict();
app.post('/api/v1/sessions/:id/attendance', async (c) => {
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (!(await consumeRateLimit(c.env.DB, `attendance:${session.user.id}`, 30, 60000, Date.now())))
    return c.json({ error: 'rate_limit' }, 429);
  const parsed = attendanceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const t = await c.env.DB.prepare(
    'SELECT s.* FROM training_sessions s JOIN memberships m ON m.group_jid=s.group_jid WHERE s.id=? AND m.user_id=? AND m.active=1',
  )
    .bind(c.req.param('id'), session.user.id)
    .first<Training>();
  if (!t) return c.json({ error: 'not_found' }, 404);
  if (t.version !== parsed.data.version || t.status !== 'scheduled' || t.end_at <= Date.now())
    return c.json({ error: 'session_changed' }, 409);
  const now = Date.now(),
    eventId = `web:${crypto.randomUUID()}`,
    response = parsed.data.response;
  const result = await recordAttendance(
    {
      env: c.env,
      user: session.user,
      chatJid: session.user.jid,
      isGroup: false,
      text: '',
      eventId,
      timestamp: now,
      now,
      origin: await setting(c.env.DB, 'origin'),
    },
    t,
    {
      id: eventId,
      timestamp: now,
      source: 'private',
      attendance:
        response === 'no' ? 'no' : response === 'yes' || response === 'late' ? 'yes' : undefined,
      late: response === 'late' ? true : response === 'punctual' ? false : undefined,
      minutes: parsed.data.minutes,
    },
    undefined,
    false,
  );
  if (result === 'forbidden') return c.json({ error: 'forbidden' }, 403);
  if (result === 'unavailable') return c.json({ error: 'session_changed' }, 409);
  return c.json({ ok: true, status: result });
});
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
app.all('/webhooks/*', (c) => c.json({ error: 'not_found' }, 404));
app.get('/r/:id', async (c) => {
  const t = await c.env.DB.prepare(
    "SELECT id FROM training_sessions WHERE id=? AND status='scheduled' AND end_at>?",
  )
    .bind(c.req.param('id'), Date.now())
    .first<{ id: string }>();
  if (!t) return c.text('Dieser Termin ist nicht mehr verfügbar.', 404);
  c.header('Cache-Control', 'no-store');
  // Old links remain harmless; new notices use native WhatsApp reactions only.
  return c.redirect('/info', 302);
});
app.get('*', async (c) => {
  const botJid = await setting(c.env.DB, 'bot_jid');
  const options = {
    botName: await setting(c.env.DB, 'bot_name', 'Marius Bot'),
    infoText: await setting(c.env.DB, 'info_text'),
    privacyText: await setting(c.env.DB, 'privacy_text'),
    botNumber: botJid.endsWith('@s.whatsapp.net') ? botJid.split('@')[0] : '',
    origin: await setting(c.env.DB, 'origin', 'https://tt.bz3.eu'),
  };
  if (c.req.path.startsWith('/t/')) {
    const t = await c.env.DB.prepare('SELECT * FROM training_sessions WHERE id=?')
      .bind(decodeURIComponent(c.req.path.slice(3)))
      .first<Training>();
    if (!t) return c.text('Termin nicht gefunden.', 404);
    return c.html(
      renderPage('/info', {
        ...options,
        infoText: `${t.status === 'cancelled' ? 'Abgesagt: ' : ''}${label(t)}\n\n${options.infoText}`,
      })!,
    );
  }
  const page = renderPage(c.req.path, options);
  if (page !== null) return c.html(page);
  if (['/style.css', '/app.js', '/favicon.svg'].includes(c.req.path))
    return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Seite nicht gefunden.', 404);
});

export async function scheduled(env: Env, now = Date.now()): Promise<void> {
  await drainInbox(env, now);
  await planJobs(env.DB, now);
  await planTrainerSummaries(env.DB, now);
  if (env.EVOLUTION_API_KEY) await sendOutbox(env, now);
  await cleanup(env.DB, now);
  await setSetting(env.DB, 'last_cron', new Date(now).toISOString());
}
export default {
  fetch: app.fetch,
  scheduled: async (controller: ScheduledController, env: Env) =>
    scheduled(env, controller.scheduledTime),
};
