import { setting } from './db';

/** Replace spent credentials in their original private message; never send a
 * second login notification. The durable outbox handles errors and retries. */
export async function planLoginMessageEdits(db: D1Database, now = Date.now()): Promise<void> {
  const origin = await setting(db, 'origin');
  if (!origin) return;
  const text = `🏓 Dein Zugang zu TT\n${origin}/login\n\nHier öffnest du deinen Trainerbereich oder dein Konto. Solange du angemeldet bist, brauchst du keinen neuen Link. Falls deine Anmeldung abgelaufen ist, schreib mir „anmelden“.\n\nDer einmalige Anmeldelink ist nicht mehr gültig.`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO outbox_jobs(id,dedupe_key,chat_jid,user_id,kind,text,due_at,expires_at,created_at,target_message_id)
     SELECT lower(hex(randomblob(16))),'login-edit:'||l.event_id,o.chat_jid,l.user_id,'login_edit',?,?,o.created_at+840000,?,o.provider_id
     FROM auth_magic_links l JOIN outbox_jobs o ON o.dedupe_key='reply:'||l.event_id||':0'
     WHERE o.created_at>? AND (l.state!='pending' OR l.expires_at<=?) AND o.status='sent' AND o.provider_id IS NOT NULL`,
    )
    .bind(text, now, now, now - 840000, now)
    .run();
}
