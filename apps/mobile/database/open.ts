import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { migrate } from './migrations';
import type { SqlDatabase } from './types';

export const DATABASE_NAME = 'threshold.db';
const KEY_ALIAS = 'threshold.db.key.v1';

/**
 * Database encryption key: 32 random bytes from the platform CSPRNG, hex-encoded and stored in
 * the iOS Keychain via expo-secure-store with "after first unlock, this device only" so it is
 * excluded from backups and unavailable to other devices.
 */
async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ALIAS);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const bytes = Crypto.getRandomBytes(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_ALIAS, hex, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return hex;
}

/** expo-sqlite accepts bind params as an array; this adapter narrows the surface to SqlDatabase. */
function adapt(db: SQLiteDatabase): SqlDatabase {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params = []) => db.runAsync(sql, params),
    getFirstAsync: <T,>(sql: string, params: (string | number | null)[] = []) => db.getFirstAsync<T>(sql, params),
    getAllAsync: <T,>(sql: string, params: (string | number | null)[] = []) => db.getAllAsync<T>(sql, params),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
  };
}

export interface OpenedDatabase {
  db: SqlDatabase;
  raw: SQLiteDatabase;
  encrypted: boolean;
}

/**
 * Opens the encrypted local database (SQLCipher via the expo-sqlite config plugin's
 * `useSQLCipher: true`) and applies migrations. The key is applied with a raw-hex key literal
 * (x'…'), validated above to contain only hex digits, so no untrusted text reaches PRAGMA.
 *
 * NOTE: `withExclusiveTransactionAsync` opens a separate connection that would not receive the
 * key, so the app only uses `withTransactionAsync`.
 */
export async function openAppDatabase(): Promise<OpenedDatabase> {
  const key = await getOrCreateKey();
  const raw = await openDatabaseAsync(DATABASE_NAME);
  await raw.execAsync(`PRAGMA key = "x'${key}'";`);
  // Verify the key/cipher actually work before any schema access.
  const cipher = await raw.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version;');
  await raw.execAsync('PRAGMA journal_mode = WAL;');
  const db = adapt(raw);
  await migrate(db);
  return { db, raw, encrypted: Boolean(cipher?.cipher_version) };
}

export async function destroyLocalDatabase(raw: SQLiteDatabase): Promise<void> {
  const { deleteDatabaseAsync } = await import('expo-sqlite');
  await raw.closeAsync();
  await deleteDatabaseAsync(DATABASE_NAME);
  await SecureStore.deleteItemAsync(KEY_ALIAS);
}
