/**
 * Minimal async SQL interface. `expo-sqlite`'s SQLiteDatabase satisfies it on device; tests use
 * an sql.js adapter (tests/support/sqljsDatabase.ts). Repositories depend only on this.
 */
export type SqlParam = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<SqlRunResult>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const bool = (v: boolean): number => (v ? 1 : 0);
export const fromBool = (v: number | null | undefined): boolean => v === 1;

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
