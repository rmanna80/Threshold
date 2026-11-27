import type {
  ConsentRecord,
  ConsentType,
  EligibilityRecord,
  UserGoals,
  UserPreferences,
} from '@threshold/shared-types';
import { consentRecordSchema, parseWith, userGoalsSchema, userPreferencesSchema } from '@threshold/validation';
import { bool, fromBool, parseJson, type SqlDatabase } from '../types';

export interface ProfileRow {
  eligibility: EligibilityRecord | null;
  onboardingCompletedAt: number | null;
}

export class SettingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async getProfile(): Promise<ProfileRow> {
    const row = await this.db.getFirstAsync<{ eligibility_json: string | null; onboarding_completed_at: number | null }>(
      'SELECT eligibility_json, onboarding_completed_at FROM user_profile WHERE id = 1',
    );
    return {
      eligibility: parseJson<EligibilityRecord | null>(row?.eligibility_json, null),
      onboardingCompletedAt: row?.onboarding_completed_at ?? null,
    };
  }

  async saveEligibility(record: EligibilityRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO user_profile (id, eligibility_json, created_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET eligibility_json = excluded.eligibility_json`,
      [JSON.stringify(record), record.confirmedAt],
    );
  }

  async completeOnboarding(at: number): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO user_profile (id, onboarding_completed_at, created_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET onboarding_completed_at = excluded.onboarding_completed_at`,
      [at, at],
    );
  }

  async getPreferences(): Promise<UserPreferences | null> {
    const row = await this.db.getFirstAsync<{ json: string }>('SELECT json FROM user_preferences WHERE id = 1');
    if (!row) return null;
    const parsed = parseWith(userPreferencesSchema, parseJson(row.json, null));
    return parsed.ok ? parsed.value : null;
  }

  async savePreferences(prefs: UserPreferences): Promise<void> {
    const parsed = parseWith(userPreferencesSchema, prefs);
    if (!parsed.ok) throw new Error(`Invalid preferences: ${parsed.error}`);
    await this.db.runAsync(
      `INSERT INTO user_preferences (id, json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      [JSON.stringify(parsed.value), prefs.updatedAt],
    );
  }

  async getGoals(): Promise<UserGoals | null> {
    const row = await this.db.getFirstAsync<{ json: string }>('SELECT json FROM user_goals WHERE id = 1');
    if (!row) return null;
    const parsed = parseWith(userGoalsSchema, parseJson(row.json, null));
    return parsed.ok ? parsed.value : null;
  }

  async saveGoals(goals: UserGoals): Promise<void> {
    const parsed = parseWith(userGoalsSchema, goals);
    if (!parsed.ok) throw new Error(`Invalid goals: ${parsed.error}`);
    await this.db.runAsync(
      `INSERT INTO user_goals (id, json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      [JSON.stringify(parsed.value), goals.updatedAt],
    );
  }

  /** Consent history is append-only so every grant/revocation is auditable. */
  async recordConsent(record: ConsentRecord): Promise<void> {
    const parsed = parseWith(consentRecordSchema, record);
    if (!parsed.ok) throw new Error(`Invalid consent: ${parsed.error}`);
    await this.db.runAsync(
      'INSERT INTO user_consents (id, type, granted, version, recorded_at) VALUES (?, ?, ?, ?, ?)',
      [record.id, record.type, bool(record.granted), record.version, record.recordedAt],
    );
  }

  /** Latest decision per consent type. */
  async latestConsents(): Promise<Partial<Record<ConsentType, ConsentRecord>>> {
    const rows = await this.db.getAllAsync<{ id: string; type: ConsentType; granted: number; version: string; recorded_at: number }>(
      `SELECT c.id, c.type, c.granted, c.version, c.recorded_at FROM user_consents c
       WHERE c.recorded_at = (SELECT MAX(recorded_at) FROM user_consents WHERE type = c.type)
       ORDER BY c.recorded_at ASC, c.rowid ASC`,
    );
    const out: Partial<Record<ConsentType, ConsentRecord>> = {};
    for (const r of rows) {
      out[r.type] = { id: r.id, type: r.type, granted: fromBool(r.granted), version: r.version, recordedAt: r.recorded_at };
    }
    return out;
  }

  async consentHistory(): Promise<ConsentRecord[]> {
    const rows = await this.db.getAllAsync<{ id: string; type: ConsentType; granted: number; version: string; recorded_at: number }>(
      'SELECT id, type, granted, version, recorded_at FROM user_consents ORDER BY recorded_at ASC, rowid ASC',
    );
    return rows.map((r) => ({ id: r.id, type: r.type, granted: fromBool(r.granted), version: r.version, recordedAt: r.recorded_at }));
  }
}

export class KvRepository {
  constructor(private readonly db: SqlDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async set(key: string, value: string, now: number): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, now],
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
  }
}
