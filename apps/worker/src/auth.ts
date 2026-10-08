import type { Hono } from 'hono';
import type { AppBindings, BotContext, Env, User } from './types';
import { all, setting } from './db';
import { consumeRateLimit, hashToken, randomToken } from './security';

type Role = 'owner' | 'admin' | null;
type Conversation = { kind: string; data: string; expires_at: number };
type DialogData = { id?: string; eventId: string; timestamp: number; challengeId?: string };
type Challenge = { id: string; state: string; user_id: string | null; expires_at: number };
const FIVE_MINUTES = 5 * 60_000;
const BROWSER_COOKIE = '__Host-tt-browser';
const SESSION_COOKIE = '__Host-tt-session';
const tokenPattern = /^[a-f0-9]{32,128}$/;
const REPLAY_REPLY =
  'Deine Anfrage wurde bereits verarbeitet. Mit /konto kannst du deinen aktuellen Kontostatus prüfen.';

async function incomingCredential(
  ctx: BotContext,
  raw: string | undefined,
): Promise<string | null> {
  if (ctx.credentialHash !== undefined)
    return /^[a-f0-9]{64}$/.test(ctx.credentialHash) ? ctx.credentialHash : null;
  return raw && tokenPattern.test(raw) ? hashToken(raw) : null;
}

export async function getRole(db: D1Database, userId: string): Promise<Role> {
  return (
    (
      await db
        .prepare('SELECT role FROM roles WHERE user_id=?')
        .bind(userId)
        .first<{ role: 'owner' | 'admin' }>()
    )?.role ?? null
  );
}

/** Aliases must originate in the authenticated provider event, never in user text. */
export async function resolveUser(
  env: Env,
  senderJid: string,
  aliases: string[],
  displayName: string,
  now: number,
): Promise<User | null> {
  const jids = [...new Set([senderJid, ...aliases])];
  if (jids.length > 4 || jids.some((jid) => !/^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(jid)))
    return null;
  const placeholders = jids.map(() => '?').join(',');
  const lookup = () =>
    all<User>(
      env.DB,
      `SELECT DISTINCT users.* FROM users LEFT JOIN identity_aliases a ON a.user_id=users.id
    WHERE users.jid IN (${placeholders}) OR a.jid IN (${placeholders})`,
      ...jids,
      ...jids,
    );
  const found = await lookup();
  if (found.length > 1) return null;
  const user = found[0] ?? {
    id: crypto.randomUUID(),
    jid: senderJid,
    display_name: displayName.slice(0, 80),
    registered_at: null,
    reminders: 0,
    created_at: now,
  };
  try {
    await env.DB.batch([
      ...(!found.length
        ? [
            env.DB.prepare(
              'INSERT INTO users(id,jid,display_name,created_at) VALUES(?,?,?,?)',
            ).bind(user.id, user.jid, user.display_name, now),
          ]
        : []),
      ...jids.map((jid) =>
        env.DB.prepare(
          `INSERT INTO identity_aliases(jid,user_id) VALUES(?,?)
        ON CONFLICT(jid) DO UPDATE SET user_id=CASE WHEN identity_aliases.user_id=excluded.user_id THEN identity_aliases.user_id ELSE NULL END`,
        ).bind(jid, user.id),
      ),
    ]);
    return user;
  } catch {
    // A concurrent identity creation may have won. Never merge two existing users.
    const current = await lookup();
    if (current.length !== 1) return null;
    const mapped = await all<{ jid: string }>(
      env.DB,
      `SELECT jid FROM identity_aliases WHERE user_id=? AND jid IN (${placeholders})`,
      current[0].id,
      ...jids,
    );
    return mapped.length === jids.length ? current[0] : null;
  }
}

function cookie(request: Request, name: string): string | null {
  const values = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return tokenPattern.test(value) ? value : null;
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function getSession(
  request: Request,
  env: Env,
  now = Date.now(),
): Promise<{ user: User; role: Role; authenticatedAt: number } | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.*,s.authenticated_at FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.registered_at IS NOT NULL`,
  )
    .bind(await hashToken(token), now)
    .first<User & { authenticated_at: number }>();
  if (!row) return null;
  const role = await getRole(env.DB, row.id);
  if (role && now - row.authenticated_at >= 8 * 60 * 60_000) return null;
  const { authenticated_at, ...user } = row;
  return { user, role, authenticatedAt: authenticated_at };
}

export function registerAuthRoutes(app: Hono<AppBindings>): void {
  app.use('/api/v1/auth/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'GET') {
      const origin = await setting(c.env.DB, 'origin', 'https://tt.bz3.eu');
      if (c.req.header('Origin') !== origin || new URL(c.req.url).origin !== origin)
        return c.json({ error: 'origin' }, 403);
    }
    await next();
  });
  app.post('/api/v1/auth/start', async (c) => {
    const now = Date.now();
    const ipHash = await hashToken(c.req.header('CF-Connecting-IP') ?? 'unknown');
    if (!(await consumeRateLimit(c.env.DB, `auth:start:${ipHash}`, 10, 15 * 60_000, now)))
      return c.json({ error: 'rate_limit' }, 429);
    const botJid = await setting(c.env.DB, 'bot_jid');
    if (
      !/^\d{5,20}@s\.whatsapp\.net$/.test(botJid) ||
      (await setting(c.env.DB, 'privacy_ready')) !== '1'
    )
      return c.json({ error: 'not_ready' }, 503);
    const code = randomToken(16),
      browser = randomToken(),
      id = crypto.randomUUID();
    const oldBrowser = cookie(c.req.raw, BROWSER_COOKIE);
    await c.env.DB.batch([
      ...(oldBrowser
        ? [
            c.env.DB.prepare(
              "UPDATE auth_challenges SET state='rejected' WHERE browser_hash=? AND state IN ('pending','claimed','confirmed')",
            ).bind(await hashToken(oldBrowser)),
          ]
        : []),
      c.env.DB.prepare(
        'INSERT INTO auth_challenges(id,code_hash,browser_hash,created_at,expires_at) VALUES(?,?,?,?,?)',
      ).bind(id, await hashToken(code), await hashToken(browser), now, now + FIVE_MINUTES),
    ]);
    c.header('Set-Cookie', cookieHeader(BROWSER_COOKIE, browser, 300), { append: true });
    return c.json({
      code,
      waLink: `https://wa.me/${botJid.split('@')[0]}?text=${encodeURIComponent(`/login ${code}`)}`,
      expiresAt: now + FIVE_MINUTES,
    });
  });
  app.get('/api/v1/auth/status', async (c) => {
    const token = cookie(c.req.raw, BROWSER_COOKIE);
    const challenge = token
      ? await c.env.DB.prepare('SELECT state,expires_at FROM auth_challenges WHERE browser_hash=?')
          .bind(await hashToken(token))
          .first<{ state: string; expires_at: number }>()
      : null;
    const status =
      !challenge ||
      challenge.expires_at <= Date.now() ||
      ['used', 'rejected'].includes(challenge.state)
        ? 'expired'
        : challenge.state === 'confirmed'
          ? 'confirmed'
          : 'pending';
    return c.json({ status });
  });
  app.post('/api/v1/auth/finish', async (c) => {
    const now = Date.now(),
      browser = cookie(c.req.raw, BROWSER_COOKIE);
    if (!browser) return c.json({ error: 'invalid_challenge' }, 401);
    const browserHash = await hashToken(browser);
    if (!(await consumeRateLimit(c.env.DB, `auth:finish:${browserHash}`, 20, FIVE_MINUTES, now)))
      return c.json({ error: 'rate_limit' }, 429);
    const session = randomToken(),
      sessionHash = await hashToken(session);
    const previous = cookie(c.req.raw, SESSION_COOKIE);
    const statements = [
      c.env.DB.prepare(
        `UPDATE auth_challenges SET state='used',exchange_hash=? WHERE browser_hash=? AND state='confirmed' AND expires_at>?
        AND EXISTS(SELECT 1 FROM users WHERE id=auth_challenges.user_id AND registered_at IS NOT NULL)`,
      ).bind(sessionHash, browserHash, now),
      c.env.DB.prepare(
        `INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,expires_at)
        SELECT exchange_hash,user_id,confirmed_at,? + CASE WHEN EXISTS(SELECT 1 FROM roles WHERE roles.user_id=auth_challenges.user_id) THEN 28800000 ELSE 604800000 END
        FROM auth_challenges WHERE browser_hash=? AND exchange_hash=? AND state='used'`,
      ).bind(now, browserHash, sessionHash),
    ];
    if (previous)
      statements.push(
        c.env.DB.prepare(
          'DELETE FROM auth_sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=?)',
        ).bind(await hashToken(previous), sessionHash),
      );
    const results = await c.env.DB.batch(statements);
    if (results[1].meta.changes !== 1) return c.json({ error: 'invalid_challenge' }, 401);
    c.header('Set-Cookie', cookieHeader(SESSION_COOKIE, session, 604800), { append: true });
    c.header('Set-Cookie', cookieHeader(BROWSER_COOKIE, '', 0), { append: true });
    return c.json({ ok: true });
  });
  app.post('/api/v1/auth/logout', async (c) => {
    const token = cookie(c.req.raw, SESSION_COOKIE);
    if (token)
      await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?')
        .bind(await hashToken(token))
        .run();
    c.header('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0), { append: true });
    return c.json({ ok: true });
  });
  app.get('/api/v1/me', async (c) => {
    c.header('Cache-Control', 'no-store');
    const session = await getSession(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    const { user, role, authenticatedAt } = session;
    return c.json({
      user: {
        id: user.id,
        displayName: user.display_name,
        registeredAt: user.registered_at,
        reminders: !!user.reminders,
      },
      role,
      authenticatedAt,
    });
  });
}

async function dialog(
  ctx: BotContext,
  kind: string,
  data: Omit<DialogData, 'eventId' | 'timestamp'> = {},
  expiresAt = ctx.now + FIVE_MINUTES,
): Promise<void> {
  await ctx.env.DB.prepare(
    `INSERT INTO conversations(user_id,kind,data,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,data=excluded.data,expires_at=excluded.expires_at`,
  )
    .bind(
      ctx.user.id,
      `auth:${kind}`,
      JSON.stringify({ ...data, eventId: ctx.eventId, timestamp: ctx.timestamp }),
      expiresAt,
    )
    .run();
}

function auditStatement(ctx: BotContext, action: string, detail = ''): D1PreparedStatement {
  return ctx.env.DB.prepare(
    'INSERT INTO audit_log(id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)',
  ).bind(crypto.randomUUID(), ctx.user.id, action, detail, ctx.now);
}

function consentStatement(
  ctx: BotContext,
  purpose: string,
  accepted: boolean,
): D1PreparedStatement {
  if (purpose === 'reminders' && !accepted)
    return ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO consents(id,user_id,purpose,version,accepted,event_id,created_at)
    SELECT ?,?,'reminders','1',0,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND reminders=0 AND reminders_updated_at=?)`,
    ).bind(crypto.randomUUID(), ctx.user.id, ctx.eventId, ctx.now, ctx.user.id, ctx.timestamp);
  return ctx.env.DB.prepare(
    'INSERT OR IGNORE INTO consents(id,user_id,purpose,version,accepted,event_id,created_at) VALUES(?,?,?,?,?,?,?)',
  ).bind(crypto.randomUUID(), ctx.user.id, purpose, '1', accepted ? 1 : 0, ctx.eventId, ctx.now);
}

async function finishDialog(
  ctx: BotContext,
  conversation: Conversation,
  statements: D1PreparedStatement[],
): Promise<void> {
  // CHECK(claim=1) aborts the complete transaction if a concurrent command
  // replaced this dialog. A unique event receipt also prevents replay.
  const needsOwner = ['auth:admin_grant', 'auth:admin_remove'].includes(conversation.kind);
  const deletingAccount =
    conversation.kind === 'auth:delete' && ctx.text.trim().toUpperCase() === 'JA';
  const enablingReminders =
    conversation.kind === 'auth:reminders' && ctx.text.trim().toUpperCase() === 'JA';
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO auth_receipts(event_id,created_at,claim) VALUES(?,?,
      EXISTS(SELECT 1 FROM conversations WHERE user_id=? AND kind=? AND data=? AND expires_at>?)
      AND (?=0 OR EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner'))
      AND (?=0 OR NOT EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner'))
      AND (?=0 OR EXISTS(SELECT 1 FROM users WHERE id=? AND reminders_updated_at<?)))`,
    ).bind(
      ctx.eventId,
      ctx.now,
      ctx.user.id,
      conversation.kind,
      conversation.data,
      ctx.now,
      needsOwner ? 1 : 0,
      ctx.user.id,
      deletingAccount ? 1 : 0,
      ctx.user.id,
      enablingReminders ? 1 : 0,
      ctx.user.id,
      ctx.timestamp,
    ),
    ...statements,
    ctx.env.DB.prepare('DELETE FROM conversations WHERE user_id=? AND kind=? AND data=?').bind(
      ctx.user.id,
      conversation.kind,
      conversation.data,
    ),
  ]);
}

async function registration(ctx: BotContext, challengeId?: string): Promise<string[]> {
  if ((await setting(ctx.env.DB, 'privacy_ready')) !== '1')
    return ['Die Registrierung ist noch nicht freigegeben. Bitte wende dich an den Trainer.'];
  await dialog(ctx, 'register', { challengeId });
  return [
    `Möchtest du ein freiwilliges TT-Konto anlegen? Dafür speichern wir deine WhatsApp-Kennung und deinen Anzeigenamen. Datenschutz: ${ctx.origin}/datenschutz. Persönliche Erinnerungen bleiben ausgeschaltet. Antworte mit JA oder NEIN.`,
  ];
}

async function confirmDialog(
  ctx: BotContext,
  conversation: Conversation,
): Promise<string[] | null> {
  const answer = ctx.text.trim().toLocaleUpperCase('de-DE');
  if (!['JA', 'NEIN'].includes(answer)) return null;
  const data = JSON.parse(conversation.data) as DialogData;
  if (ctx.timestamp <= data.timestamp || data.eventId === ctx.eventId) return [];
  const db = ctx.env.DB,
    yes = answer === 'JA';
  if (conversation.expires_at <= ctx.now)
    return ['Die Bestätigung ist abgelaufen. Bitte starte den Vorgang erneut.'];
  if (await db.prepare('SELECT 1 FROM auth_receipts WHERE event_id=?').bind(ctx.eventId).first())
    return [REPLAY_REPLY];
  if (conversation.kind === 'auth:bootstrap') {
    if (!yes) {
      await finishDialog(ctx, conversation, [
        db
          .prepare(
            "UPDATE bootstrap SET state='closed',code_hash=NULL WHERE id=1 AND state='reserved' AND reserved_user_id=?",
          )
          .bind(ctx.user.id),
      ]);
      return ['Einrichtung abgebrochen. Nur der Betreiber kann einen neuen Versuch freigeben.'];
    }
    await finishDialog(ctx, conversation, [
      db
        .prepare(
          `INSERT INTO roles(user_id,role,created_at) SELECT ?,'owner',? FROM bootstrap WHERE id=1 AND state='reserved' AND reserved_user_id=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM roles WHERE role='owner')`,
        )
        .bind(ctx.user.id, ctx.now, ctx.user.id, ctx.now),
      db
        .prepare(
          `UPDATE bootstrap SET state='completed',code_hash=NULL,completed_at=? WHERE id=1 AND state='reserved' AND reserved_user_id=? AND expires_at>? AND EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')`,
        )
        .bind(ctx.now, ctx.user.id, ctx.now, ctx.user.id),
      auditStatement(ctx, 'bootstrap.confirmed'),
    ]);
    return (await getRole(db, ctx.user.id)) === 'owner'
      ? [
          'Du bist jetzt der erste Owner. /hilfe zeigt dir die nächsten Schritte. Ein freiwilliges Webkonto und Erinnerungen kannst du später mit /login einrichten.',
        ]
      : ['Die Einrichtung konnte nicht bestätigt werden. Bitte wende dich an den Betreiber.'];
  }
  if (conversation.kind === 'auth:login') {
    const challenge = await db
      .prepare(
        "SELECT id,state,user_id,expires_at FROM auth_challenges WHERE id=? AND state='claimed' AND user_id=? AND expires_at>?",
      )
      .bind(data.id, ctx.user.id, ctx.now)
      .first<Challenge>();
    if (!challenge)
      return [
        'Diese Anmeldung ist abgelaufen oder bereits verwendet. Starte sie im Browser erneut.',
      ];
    if (yes && !ctx.user.registered_at) return registration(ctx, challenge.id);
    await finishDialog(ctx, conversation, [
      db
        .prepare(
          `UPDATE auth_challenges SET state=?,confirmed_at=? WHERE id=? AND state='claimed' AND user_id=? AND expires_at>?`,
        )
        .bind(
          yes ? 'confirmed' : 'rejected',
          yes ? ctx.now : null,
          challenge.id,
          ctx.user.id,
          ctx.now,
        ),
    ]);
    return [yes ? 'Anmeldung bestätigt. Kehre zu deinem Browser zurück.' : 'Anmeldung abgelehnt.'];
  }
  if (conversation.kind === 'auth:register') {
    if (yes && (await setting(db, 'privacy_ready')) !== '1')
      return ['Die Registrierung ist derzeit nicht freigegeben.'];
    await finishDialog(ctx, conversation, [
      ...(yes
        ? [
            db
              .prepare('UPDATE users SET registered_at=COALESCE(registered_at,?) WHERE id=?')
              .bind(ctx.now, ctx.user.id),
            consentStatement(ctx, 'registration', true),
          ]
        : []),
      ...(data.challengeId
        ? [
            db
              .prepare(
                "UPDATE auth_challenges SET state=?,confirmed_at=? WHERE id=? AND state='claimed' AND user_id=? AND expires_at>?",
              )
              .bind(
                yes ? 'confirmed' : 'rejected',
                yes ? ctx.now : null,
                data.challengeId,
                ctx.user.id,
                ctx.now,
              ),
          ]
        : []),
    ]);
    return [
      yes
        ? `Dein Konto ist angelegt.${data.challengeId ? ' Kehre zum Browser zurück.' : ''} Persönliche Erinnerungen kannst du separat mit /start aktivieren.`
        : 'Es wurde kein Konto angelegt. Teilnahme am Training bleibt ohne Konto möglich.',
    ];
  }
  if (conversation.kind === 'auth:reminders') {
    if (yes && (!ctx.user.registered_at || (await setting(db, 'privacy_ready')) !== '1'))
      return ['Bitte richte zuerst dein Konto mit /login ein.'];
    if (
      yes &&
      ((await db
        .prepare('SELECT reminders_updated_at FROM users WHERE id=?')
        .bind(ctx.user.id)
        .first<number>('reminders_updated_at')) ?? 0) >= ctx.timestamp
    )
      return [
        'Eine neuere Erinnerungseinstellung liegt bereits vor. Bitte starte bei Bedarf erneut mit /start.',
      ];
    await finishDialog(
      ctx,
      conversation,
      yes
        ? [
            db
              .prepare(
                'UPDATE users SET reminders=1,reminders_updated_at=? WHERE id=? AND registered_at IS NOT NULL',
              )
              .bind(ctx.timestamp, ctx.user.id),
            consentStatement(ctx, 'reminders', true),
          ]
        : [],
    );
    return [
      yes
        ? 'Persönliche Trainingserinnerungen sind aktiviert. Mit /stop kannst du sie jederzeit abbestellen.'
        : 'Deine Erinnerungseinstellungen bleiben unverändert. Mit /stop kannst du Erinnerungen ausschalten.',
    ];
  }
  if (conversation.kind === 'auth:delete') {
    if (!yes) {
      await finishDialog(ctx, conversation, []);
      return ['Dein Konto bleibt bestehen.'];
    }
    if ((await getRole(db, ctx.user.id)) === 'owner')
      return ['Ein Owner kann sein Konto erst nach bestätigter Übertragung der Rolle löschen.'];
    await finishDialog(ctx, conversation, [
      auditStatement(ctx, 'account.deleted'),
      db
        .prepare(
          "DELETE FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')",
        )
        .bind(ctx.user.id, ctx.user.id),
    ]);
    return [
      'Dein TT-Konto und die zugehörigen Teilnahme- und Erinnerungsdaten wurden gelöscht. Daten in WhatsApp und bei Evolution sind davon getrennt.',
    ];
  }
  if (conversation.kind === 'auth:admin_grant') {
    if ((await getRole(db, ctx.user.id)) !== 'owner')
      return ['Dafür ist die Owner-Rolle erforderlich.'];
    const invite = await db
      .prepare(
        "SELECT candidate_id,grant_role FROM admin_invites WHERE id=? AND owner_id=? AND state='claimed' AND expires_at>?",
      )
      .bind(data.id, ctx.user.id, ctx.now)
      .first<{ candidate_id: string; grant_role: 'admin' | 'owner' }>();
    if (!invite) return ['Diese Einladung ist nicht mehr gültig.'];
    await finishDialog(
      ctx,
      conversation,
      yes
        ? [
            db
              .prepare(
                `INSERT INTO roles(user_id,role,created_at) SELECT candidate_id,grant_role,? FROM admin_invites WHERE id=? AND owner_id=? AND state='claimed' AND expires_at>?
        AND EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')
        ON CONFLICT(user_id) DO UPDATE SET role=CASE WHEN roles.role='owner' THEN 'owner' ELSE excluded.role END`,
              )
              .bind(ctx.now, data.id, ctx.user.id, ctx.now, ctx.user.id),
            ...(invite.grant_role === 'owner'
              ? [
                  db
                    .prepare(
                      "UPDATE roles SET role='admin' WHERE user_id=? AND role='owner' AND EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')",
                    )
                    .bind(ctx.user.id, invite.candidate_id),
                ]
              : []),
            db
              .prepare(
                "UPDATE admin_invites SET state='used',code_hash=? WHERE id=? AND state='claimed'",
              )
              .bind(await hashToken(randomToken()), data.id),
            auditStatement(
              ctx,
              invite.grant_role === 'owner' ? 'owner.transferred' : 'admin.granted',
              invite.candidate_id,
            ),
          ]
        : [
            db
              .prepare("UPDATE admin_invites SET state='rejected' WHERE id=? AND owner_id=?")
              .bind(data.id, ctx.user.id),
          ],
    );
    return [yes ? 'Die Rollenänderung ist bestätigt.' : 'Die Einladung wurde abgelehnt.'];
  }
  if (conversation.kind === 'auth:admin_remove') {
    if ((await getRole(db, ctx.user.id)) !== 'owner')
      return ['Dafür ist die Owner-Rolle erforderlich.'];
    await finishDialog(
      ctx,
      conversation,
      yes
        ? [
            db
              .prepare(
                "DELETE FROM roles WHERE user_id=? AND role='admin' AND EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='owner')",
              )
              .bind(data.id, ctx.user.id),
            auditStatement(ctx, 'admin.removed', data.id),
          ]
        : [],
    );
    return [yes ? 'Die Adminrolle wurde entfernt.' : 'Die Rolle bleibt bestehen.'];
  }
  return null;
}

export async function handleAccountMessage(ctx: BotContext): Promise<string[] | null> {
  const text = ctx.text.trim(),
    parts = text.split(/\s+/),
    command = parts[0].toLocaleLowerCase('de-DE');
  const accountCommand = [
    '/einrichten',
    '/admin',
    '/login',
    '/start',
    '/stop',
    '/konto',
    '/daten',
    '/löschen',
    '/loeschen',
  ].includes(command);
  if (ctx.isGroup)
    return accountCommand
      ? [
          'Bitte schreibe diesen Befehl privat an den Bot. Codes und Kontodaten gehören nicht in die Gruppe.',
        ]
      : null;
  const db = ctx.env.DB;
  if (await db.prepare('SELECT 1 FROM auth_receipts WHERE event_id=?').bind(ctx.eventId).first())
    return [REPLAY_REPLY];
  const conversation = await db
    .prepare(
      "SELECT kind,data,expires_at FROM conversations WHERE user_id=? AND kind LIKE 'auth:%'",
    )
    .bind(ctx.user.id)
    .first<Conversation>();
  if (conversation && !text.startsWith('/')) return confirmDialog(ctx, conversation);
  if (!accountCommand) return null;
  if (!(await consumeRateLimit(db, `account:${ctx.user.id}`, 30, 60_000, ctx.now)))
    return ['Bitte warte eine Minute, bevor du weitere Kontobefehle sendest.'];
  if (command === '/einrichten') {
    const credential = await incomingCredential(ctx, parts[1]);
    if (!credential) return ['Der Einrichtungscode fehlt oder ist ungültig.'];
    if (!(await consumeRateLimit(db, `bootstrap:${ctx.user.id}`, 5, 15 * 60_000, ctx.now)))
      return ['Zu viele Versuche. Bitte warte 15 Minuten.'];
    const result = await db
      .prepare(
        `UPDATE bootstrap SET state='reserved',reserved_user_id=?,reservation_event_id=? WHERE id=1 AND state='pending' AND code_hash=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM roles WHERE role='owner') RETURNING expires_at`,
      )
      .bind(ctx.user.id, ctx.eventId, credential, ctx.now)
      .first<{ expires_at: number }>();
    if (!result) {
      const reserved = await db
        .prepare(
          "SELECT expires_at FROM bootstrap WHERE id=1 AND state='reserved' AND reserved_user_id=? AND reservation_event_id=? AND expires_at>?",
        )
        .bind(ctx.user.id, ctx.eventId, ctx.now)
        .first<{ expires_at: number }>();
      if (!reserved)
        return ['Der Einrichtungscode ist ungültig, abgelaufen oder bereits reserviert.'];
      await dialog(ctx, 'bootstrap', {}, reserved.expires_at);
    } else await dialog(ctx, 'bootstrap', {}, result.expires_at);
    return ['Möchtest du dich als ersten Admin und Owner ernennen? Antworte mit JA oder NEIN.'];
  }
  if (command === '/login') {
    if (!parts[1])
      return ctx.user.registered_at
        ? [
            `Dein Konto ist aktiv. Web-Anmeldung: ${ctx.origin}/login. Erinnerungen: /start oder /stop. Kontodaten: /konto.`,
          ]
        : registration(ctx);
    const credential = await incomingCredential(ctx, parts[1]);
    if (!credential)
      return ['Dieser Anmeldecode ist ungültig. Starte die Anmeldung auf der TT-Webseite.'];
    const challenge = await db
      .prepare(
        `UPDATE auth_challenges SET state='claimed',user_id=?,claim_event_id=? WHERE code_hash=? AND (state='pending' OR (state='claimed' AND user_id=? AND claim_event_id=?)) AND expires_at>? RETURNING id,expires_at`,
      )
      .bind(ctx.user.id, ctx.eventId, credential, ctx.user.id, ctx.eventId, ctx.now)
      .first<{ id: string; expires_at: number }>();
    if (!challenge) return ['Dieser Anmeldecode ist abgelaufen oder bereits verwendet.'];
    await dialog(ctx, 'login', { id: challenge.id }, challenge.expires_at);
    return [
      `Möchtest du dich in dem Browser anmelden, in dem du selbst gerade ${ctx.origin}/login geöffnet hast? Bestätige keine weitergeleiteten oder unaufgefordert erhaltenen Codes. JA bestätigt, NEIN lehnt ab.`,
    ];
  }
  if (command === '/start') {
    if (!ctx.user.registered_at) return ['Bitte lege zuerst mit /login freiwillig ein Konto an.'];
    if (
      ((await db
        .prepare('SELECT reminders_updated_at FROM users WHERE id=?')
        .bind(ctx.user.id)
        .first<number>('reminders_updated_at')) ?? 0) >= ctx.timestamp
    )
      return [
        'Eine neuere Erinnerungseinstellung liegt bereits vor. Bitte starte bei Bedarf erneut mit /start.',
      ];
    if (ctx.user.reminders)
      return [
        'Persönliche Erinnerungen sind bereits aktiviert. Mit /stop kannst du sie ausschalten.',
      ];
    await dialog(ctx, 'reminders');
    return [
      'Möchtest du persönliche WhatsApp-Erinnerungen zu deinen Gruppentrainings erhalten? Dies ist freiwillig; /stop widerruft die Zustimmung. Antworte mit JA oder NEIN.',
    ];
  }
  if (command === '/stop') {
    const changes = await db.batch([
      db
        .prepare('INSERT INTO auth_receipts(event_id,created_at) VALUES(?,?)')
        .bind(ctx.eventId, ctx.now),
      db
        .prepare(
          'UPDATE users SET reminders=0,reminders_updated_at=? WHERE id=? AND reminders_updated_at<=?',
        )
        .bind(ctx.timestamp, ctx.user.id, ctx.timestamp),
      consentStatement(ctx, 'reminders', false),
      db
        .prepare(
          "UPDATE outbox_jobs SET status='cancelled',lease_until=NULL WHERE user_id=? AND kind IN ('personal_invite','personal_late','personal_change','invite','late') AND status IN ('pending','retry','processing','leased') AND EXISTS(SELECT 1 FROM users WHERE id=? AND reminders=0)",
        )
        .bind(ctx.user.id, ctx.user.id),
      db
        .prepare(
          "DELETE FROM conversations WHERE user_id=? AND kind='auth:reminders' AND EXISTS(SELECT 1 FROM users WHERE id=? AND reminders=0)",
        )
        .bind(ctx.user.id, ctx.user.id),
    ]);
    if (!changes[1].meta.changes)
      return [
        'Eine neuere Erinnerungseinstellung liegt bereits vor. Mit /konto kannst du sie prüfen.',
      ];
    return [
      'Persönliche Erinnerungen sind ausgeschaltet; noch geplante Erinnerungen wurden gestoppt. Dein Konto bleibt bestehen.',
    ];
  }
  if (command === '/konto')
    return [
      `Konto: ${ctx.user.registered_at ? 'registriert' : 'nicht registriert'}\nName: ${ctx.user.display_name || 'nicht hinterlegt'}\nErinnerungen: ${ctx.user.reminders ? 'an' : 'aus'}\nRolle: ${(await getRole(db, ctx.user.id)) ?? 'Mitglied'}\n/daten zeigt gespeicherte Daten. /löschen startet die Kontolöschung.`,
    ];
  if (command === '/daten') {
    const [aliases, memberships, attendance, consents] = await Promise.all([
      all(db, 'SELECT jid FROM identity_aliases WHERE user_id=?', ctx.user.id),
      all(db, 'SELECT group_jid,active,updated_at FROM memberships WHERE user_id=?', ctx.user.id),
      all(
        db,
        'SELECT session_id,response,punctuality,minutes,arrival_time,updated_at FROM attendance WHERE user_id=?',
        ctx.user.id,
      ),
      all(
        db,
        'SELECT purpose,version,accepted,created_at FROM consents WHERE user_id=?',
        ctx.user.id,
      ),
    ]);
    const output = JSON.stringify(
      {
        account: ctx.user,
        role: await getRole(db, ctx.user.id),
        aliases,
        memberships,
        attendance,
        consents,
      },
      null,
      2,
    );
    return output.match(/[\s\S]{1,3500}/g) ?? [];
  }
  if (command === '/löschen' || command === '/loeschen') {
    if ((await getRole(db, ctx.user.id)) === 'owner')
      return [
        'Bitte übertrage zuerst mit /admin übertragen die Owner-Rolle. Der letzte Owner darf nicht gelöscht werden.',
      ];
    await dialog(ctx, 'delete');
    return [
      'Möchtest du dein TT-Konto einschließlich Teilnahme-, Alias- und Erinnerungsdaten löschen? Deine Web-Sitzungen werden beendet. WhatsApp und Evolution speichern Daten getrennt. Antworte mit JA oder NEIN.',
    ];
  }
  if (command === '/admin') {
    const role = await getRole(db, ctx.user.id);
    const credential = await incomingCredential(ctx, parts[1]);
    if (credential) {
      const invite = await db
        .prepare(
          `UPDATE admin_invites SET candidate_id=?,state='claimed',claim_event_id=? WHERE code_hash=? AND (state='pending' OR (state='claimed' AND candidate_id=? AND claim_event_id=?)) AND expires_at>? AND owner_id!=? RETURNING id,grant_role`,
        )
        .bind(ctx.user.id, ctx.eventId, credential, ctx.user.id, ctx.eventId, ctx.now, ctx.user.id)
        .first<{ id: string; grant_role: string }>();
      return [
        invite
          ? `Deine Bewerbung als ${invite.grant_role === 'owner' ? 'neuer Owner' : 'Admin'} wurde gespeichert. Der bisherige Owner muss deine konkrete WhatsApp-Identität bestätigen. Bitte teile ihm die Einladungs-ID ${invite.id} mit.`
          : 'Diese Einladung ist ungültig, abgelaufen oder bereits verwendet.',
      ];
    }
    if (role !== 'owner')
      return [
        'Nur der Owner kann TT-Admins verwalten. Eine Einladung kannst du mit /admin CODE annehmen.',
      ];
    if (['einladen', 'übertragen', 'uebertragen'].includes(parts[1])) {
      const existing = await db
        .prepare('SELECT id FROM admin_invites WHERE request_event_id=?')
        .bind(ctx.eventId)
        .first<{ id: string }>();
      if (existing)
        return [
          `Diese Einladung wurde bereits angelegt (ID ${existing.id}). Bei verlorener Nachricht kannst du eine neue Einladung anfordern.`,
        ];
      const code = randomToken(16),
        id = crypto.randomUUID(),
        grant = parts[1] === 'einladen' ? 'admin' : 'owner';
      await db
        .prepare(
          'INSERT INTO admin_invites(id,code_hash,request_event_id,owner_id,grant_role,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          await hashToken(code),
          ctx.eventId,
          ctx.user.id,
          grant,
          ctx.now + 30 * 60_000,
          ctx.now,
        )
        .run();
      return [
        `Einladung als ${grant === 'owner' ? 'neuer Owner' : 'Admin'} (30 Minuten gültig): Die gewünschte Person schreibt mir privat /admin ${code}. Danach prüfst und bestätigst du ihre konkrete Identität mit /admin bestätigen ${id}.${grant === 'owner' ? ' Nach der Bestätigung wirst du selbst Admin.' : ''}`,
      ];
    }
    if (['bestätigen', 'bestaetigen'].includes(parts[1]) && parts[2]) {
      const invite = await db
        .prepare(
          `SELECT i.id,i.grant_role,u.jid,u.display_name FROM admin_invites i JOIN users u ON u.id=i.candidate_id WHERE i.id=? AND i.owner_id=? AND i.state='claimed' AND i.expires_at>?`,
        )
        .bind(parts[2], ctx.user.id, ctx.now)
        .first<{ id: string; grant_role: string; jid: string; display_name: string }>();
      if (!invite) return ['Keine gültige angenommene Einladung mit dieser ID.'];
      await dialog(ctx, 'admin_grant', { id: invite.id });
      return [
        `Konkrete Person: ${invite.jid} (Anzeigename: ${invite.display_name || 'ohne Namen'}). Soll diese WhatsApp-Identität ${invite.grant_role === 'owner' ? 'Owner werden und dich als Owner ablösen' : 'Admin werden'}? Prüfe die Kennung persönlich; der Anzeigename ist kein Identitätsnachweis. JA oder NEIN.`,
      ];
    }
    if (parts[1] === 'entfernen' && parts[2]) {
      const admin = await db
        .prepare(
          "SELECT u.id,u.jid,u.display_name FROM users u JOIN roles r ON r.user_id=u.id WHERE u.id=? AND r.role='admin'",
        )
        .bind(parts[2])
        .first<User>();
      if (!admin) return ['Keine entfernbare Adminrolle mit dieser internen Nutzer-ID.'];
      await dialog(ctx, 'admin_remove', { id: admin.id });
      return [
        `Adminrolle für ${admin.jid} (${admin.display_name || 'ohne Namen'}) entfernen? JA oder NEIN.`,
      ];
    }
    const admins = await all<{ id: string; jid: string; role: string }>(
      db,
      'SELECT u.id,u.jid,r.role FROM roles r JOIN users u ON u.id=r.user_id',
    );
    const pending = await all<{ id: string; jid: string }>(
      db,
      "SELECT i.id,u.jid FROM admin_invites i JOIN users u ON u.id=i.candidate_id WHERE i.owner_id=? AND i.state='claimed' AND i.expires_at>?",
      ctx.user.id,
      ctx.now,
    );
    return [
      `TT-Rollen:\n${admins.map((a) => `${a.role}: ${a.jid} · ID ${a.id}`).join('\n')}\nAngenommene Einladungen:\n${pending.map((i) => `${i.jid} · /admin bestätigen ${i.id}`).join('\n') || 'keine'}\n/admin einladen · /admin übertragen · /admin entfernen NUTZER-ID`,
    ];
  }
  return null;
}
