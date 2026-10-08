import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Real SQLite constraints/transactions behind the small D1 interface used by TT. */
export function testDb(): D1Database & { close(): void } {
  const sqlite = new DatabaseSync(':memory:');
  const path = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const file of readdirSync(path)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(`${path}/${file}`, 'utf8'));
  function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
    const query = () => sqlite.prepare(sql);
    const result = (rows: unknown[], changes = 0) => ({
      success: true,
      results: rows,
      meta: {
        changes,
        duration: 0,
        last_row_id: 0,
        changed_db: changes > 0,
        size_after: 0,
        rows_read: rows.length,
        rows_written: changes,
      },
    });
    return {
      bind: (...args: unknown[]) => statement(sql, args),
      first: async (column?: string) => {
        const row = query().get(...(values as never[])) as Record<string, unknown> | undefined;
        return row ? (column ? row[column] : row) : null;
      },
      run: async () => {
        const r = query().run(...(values as never[]));
        return result([], Number(r.changes));
      },
      all: async () => {
        const q = query();
        const rows = q.all(...(values as never[]));
        const changes = Number(sqlite.prepare('SELECT changes() AS n').get()?.n ?? 0);
        return result(rows, /^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? changes : 0);
      },
      raw: async () =>
        query()
          .all(...(values as never[]))
          .map((row) => Object.values(row)),
    } as unknown as D1PreparedStatement;
  }
  return {
    prepare: statement,
    batch: async (statements: D1PreparedStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const rows = [];
        for (const s of statements) rows.push(await s.all());
        sqlite.exec('COMMIT');
        return rows;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    close: () => sqlite.close(),
  } as unknown as D1Database & { close(): void };
}
