export async function setting(db: D1Database, key: string, fallback = ''): Promise<string> {
  return (
    (
      await db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .bind(key)
        .first<{ value: string }>()
    )?.value ?? fallback
  );
}
export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    )
    .bind(key, value)
    .run();
}
export async function all<T>(
  db: D1Database,
  sql: string,
  ...values: (string | number | null)[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...values)
      .all<T>()
  ).results;
}
export async function audit(
  db: D1Database,
  userId: string | null,
  action: string,
  detail: string,
  now: number,
): Promise<void> {
  await db
    .prepare('INSERT INTO audit_log(id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, action, detail, now)
    .run();
}
