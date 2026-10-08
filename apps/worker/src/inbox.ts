import {
  normalizeControlWebhook,
  normalizeWebhook,
  type MessageEvent,
  type ControlEvent,
} from '@tt/whatsapp';
import { processMessage } from './bot';
import { all, setting, setSetting } from './db';
import { hashToken } from './security';
import type { Env } from './types';

type StoredEvent =
  | { kind: 'message'; event: MessageEvent & { credentialHash?: string } }
  | { kind: 'control'; event: ControlEvent; timestamp: number };
export async function acceptWebhook(env: Env, payload: unknown, now = Date.now()): Promise<number> {
  const messages = normalizeWebhook(payload, env.EVOLUTION_INSTANCE, now);
  const controls = normalizeControlWebhook(payload, env.EVOLUTION_INSTANCE);
  let count = 0;
  for (const message of messages) {
    if (
      message.isGroup &&
      ((await setting(env.DB, 'enabled')) !== '1' ||
        (await setting(env.DB, 'privacy_ready')) !== '1')
    )
      continue;
    if (
      message.isGroup &&
      !(await env.DB.prepare('SELECT jid FROM groups WHERE jid=? AND active=1')
        .bind(message.chatJid)
        .first())
    )
      continue;
    const event: MessageEvent & { credentialHash?: string } = { ...message };
    if (event.text) event.text = event.text.trim();
    // Store the credential digest, never an incoming setup/login/invitation code.
    const match = event.text?.match(/^\/(?:einrichten|login|admin)\s+([a-f0-9]{32,128})(?=\s|$)/i);
    if (match && !event.isGroup) {
      event.credentialHash = await hashToken(match[1]);
      event.text = event.text!.replace(match[1], '[geschützt]');
    }
    if (event.text) event.text = event.text.replace(/\b[a-f0-9]{32,128}\b/gi, '[geschützt]');
    // Envelope instance + chat + provider event ID scopes deduplication to this integration.
    const id = await hashToken(
      `${env.EVOLUTION_INSTANCE}:${event.chatJid}:${event.senderJid}:${event.id}`,
    );
    event.id = id;
    const stored: StoredEvent = { kind: 'message', event };
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO inbox_events(id,payload,created_at) VALUES(?,?,?)',
    )
      .bind(id, JSON.stringify(stored), now)
      .run();
    count += result.meta.changes;
  }
  for (const event of controls) {
    const raw = payload as { date_time?: unknown };
    const timestamp = typeof raw?.date_time === 'string' ? Date.parse(raw.date_time) : NaN;
    const fresh =
      Number.isFinite(timestamp) && timestamp >= now - 86400000 && timestamp <= now + 300000;
    // Missing or stale evidence may revoke access, but must never restore membership.
    if (event.kind === 'membership' && event.action === 'add' && !fresh) continue;
    const receivedTime = fresh ? timestamp : now;
    const id = await hashToken(
      `${env.EVOLUTION_INSTANCE}:${JSON.stringify(event)}:${String(raw?.date_time ?? Math.floor(now / 60000))}`,
    );
    const stored: StoredEvent = { kind: 'control', event, timestamp: receivedTime };
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO inbox_events(id,payload,created_at) VALUES(?,?,?)',
    )
      .bind(id, JSON.stringify(stored), now)
      .run();
    count += result.meta.changes;
  }
  return count;
}
async function processControl(env: Env, event: ControlEvent, now: number): Promise<void> {
  if (event.kind === 'connection') {
    await setSetting(env.DB, 'connection_state', event.state);
    return;
  }
  if (
    !(await env.DB.prepare('SELECT jid FROM groups WHERE jid=? AND active=1')
      .bind(event.chatJid)
      .first())
  )
    return;
  if (event.action !== 'add' && event.action !== 'remove') return;
  for (const jid of event.participants) {
    const user = await env.DB.prepare('SELECT user_id FROM identity_aliases WHERE jid=?')
      .bind(jid)
      .first<{ user_id: string }>();
    if (!user) continue;
    const changed = await env.DB.prepare(
      'INSERT INTO memberships(group_jid,user_id,active,updated_at) VALUES(?,?,?,?) ON CONFLICT(group_jid,user_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at WHERE excluded.updated_at>=memberships.updated_at',
    )
      .bind(event.chatJid, user.user_id, event.action === 'add' ? 1 : 0, now)
      .run();
    if (event.action === 'remove' && changed.meta.changes)
      await env.DB.prepare(
        "UPDATE outbox_jobs SET status='cancelled' WHERE user_id=? AND kind LIKE 'personal_%' AND status='pending' AND session_id IN (SELECT id FROM training_sessions WHERE group_jid=?)",
      )
        .bind(user.user_id, event.chatJid)
        .run();
  }
}
export async function drainInbox(env: Env, now = Date.now()): Promise<number> {
  await env.DB.prepare(
    "UPDATE inbox_events SET status='pending' WHERE status='processing' AND lease_until<?",
  )
    .bind(now)
    .run();
  const events = await all<{ id: string }>(
    env.DB,
    "SELECT id FROM inbox_events WHERE status='pending' AND attempts<5 ORDER BY created_at,id LIMIT 30",
  );
  let processed = 0;
  for (const candidate of events) {
    const token = crypto.randomUUID();
    const row = await env.DB.prepare(
      "UPDATE inbox_events SET status='processing',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=? AND status='pending' RETURNING payload,attempts,created_at",
    )
      .bind(now + 120000, token, candidate.id)
      .first<{ payload: string; attempts: number; created_at: number }>();
    if (!row) continue;
    try {
      if (row.created_at < now - 86400000) {
        await env.DB.prepare(
          "UPDATE inbox_events SET status='expired',payload='' WHERE id=? AND lease_token=?",
        )
          .bind(candidate.id, token)
          .run();
        continue;
      }
      const stored = JSON.parse(row.payload) as StoredEvent;
      if (stored.kind === 'message') await processMessage(env, stored.event, now);
      else await processControl(env, stored.event, stored.timestamp);
      await env.DB.prepare(
        "UPDATE inbox_events SET status='done',payload='',error=NULL WHERE id=? AND lease_token=?",
      )
        .bind(candidate.id, token)
        .run();
      processed++;
    } catch {
      await env.DB.prepare('UPDATE inbox_events SET status=?,error=? WHERE id=? AND lease_token=?')
        .bind(row.attempts >= 5 ? 'failed' : 'pending', 'processing_failed', candidate.id, token)
        .run();
    }
  }
  return processed;
}
export async function cleanup(db: D1Database, now: number): Promise<void> {
  const today = new Date(now).toISOString().slice(0, 10);
  if ((await setting(db, 'cleanup_date')) === today) return;
  const day = 86400000;
  await db.batch([
    db.prepare('DELETE FROM conversations WHERE expires_at<?').bind(now),
    db.prepare('DELETE FROM auth_challenges WHERE expires_at<?').bind(now),
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(now),
    db.prepare('DELETE FROM admin_invites WHERE expires_at<?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now),
    db.prepare('DELETE FROM auth_receipts WHERE created_at<?').bind(now - 30 * day),
    db.prepare('DELETE FROM command_receipts WHERE created_at<?').bind(now - 30 * day),
    db
      .prepare(
        "UPDATE inbox_events SET payload='',status=CASE WHEN status IN ('pending','processing') THEN 'expired' ELSE status END WHERE created_at<?",
      )
      .bind(now - day),
    db.prepare('DELETE FROM inbox_events WHERE created_at<?').bind(now - 30 * day),
    db
      .prepare(
        "UPDATE outbox_jobs SET text='' WHERE created_at<? AND status IN ('sent','failed','uncertain','expired','cancelled')",
      )
      .bind(now - 7 * day),
    db
      .prepare(
        "UPDATE outbox_jobs SET text='',status='expired' WHERE expires_at<? AND status='pending'",
      )
      .bind(now),
    db.prepare('DELETE FROM outbox_jobs WHERE created_at<?').bind(now - 30 * day),
    db
      .prepare(
        'DELETE FROM attendance WHERE session_id IN (SELECT id FROM training_sessions WHERE end_at<?)',
      )
      .bind(now - 90 * day),
    db.prepare('DELETE FROM messages WHERE created_at<?').bind(now - 90 * day),
    db.prepare('DELETE FROM audit_log WHERE created_at<?').bind(now - 180 * day),
  ]);
  await setSetting(db, 'cleanup_date', today);
}
