import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../database/migrations';
import type { SqlDatabase, SqlParam } from '../../database/types';

/**
 * In-memory SQLite (sql.js / WebAssembly) implementing the same SqlDatabase contract as
 * expo-sqlite. Lets repository and service tests run real SQL, constraints and upserts in Node.
 */
export async function createTestDatabase(options: { migrate?: boolean } = {}): Promise<SqlDatabase & { raw: Database }> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const all = <T,>(sql: string, params: SqlParam[] = []): T[] => {
    const stmt = raw.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };
  const db: SqlDatabase & { raw: Database } = {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params = []) {
      raw.run(sql, params);
      const changes = raw.getRowsModified();
      const id = raw.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];
      return { changes, lastInsertRowId: Number(id ?? 0) };
    },
    async getFirstAsync<T>(sql: string, params: SqlParam[] = []) {
      return all<T>(sql, params)[0] ?? null;
    },
    async getAllAsync<T>(sql: string, params: SqlParam[] = []) {
      return all<T>(sql, params);
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  if (options.migrate !== false) await migrate(db, () => 1);
  return db;
}
