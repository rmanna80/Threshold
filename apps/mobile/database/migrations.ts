import type { SqlDatabase } from './types';

/**
 * Versioned, forward-only local schema migrations. Each migration runs inside a transaction and
 * is recorded in `schema_migrations`. Never edit a shipped migration — append a new one.
 *
 * Conventions: TEXT UUID primary keys, INTEGER UTC epoch-ms timestamps, explicit unit suffixes.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  eligibility_json TEXT,
  onboarding_completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_goals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_consents (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  version TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consents_type_time ON user_consents(type, recorded_at);

CREATE TABLE IF NOT EXISTS beverages (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  serving_value REAL NOT NULL CHECK (serving_value > 0),
  serving_unit TEXT NOT NULL,
  abv_percent REAL CHECK (abv_percent IS NULL OR (abv_percent >= 0 AND abv_percent <= 100)),
  is_custom INTEGER NOT NULL DEFAULT 0,
  abv_varies INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_beverages_recent ON beverages(last_used_at DESC);

CREATE TABLE IF NOT EXISTS drinking_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  tz_offset_min INTEGER NOT NULL,
  pauses_json TEXT NOT NULL DEFAULT '[]',
  start_context_json TEXT NOT NULL,
  goal_snapshot_json TEXT NOT NULL,
  origin TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON drinking_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON drinking_sessions(status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drink_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES drinking_sessions(id) ON DELETE CASCADE,
  beverage_id TEXT,
  beverage_name TEXT NOT NULL,
  category TEXT NOT NULL,
  serving_value REAL NOT NULL,
  serving_unit TEXT NOT NULL,
  serving_ml REAL NOT NULL CHECK (serving_ml > 0),
  fraction_consumed REAL NOT NULL CHECK (fraction_consumed > 0 AND fraction_consumed <= 1),
  abv_percent REAL,
  ethanol_grams REAL,
  standard_drinks REAL,
  standard_drink_grams REAL NOT NULL,
  is_alcoholic INTEGER NOT NULL,
  consumed_at INTEGER NOT NULL,
  logged_at INTEGER NOT NULL,
  tz_offset_min INTEGER NOT NULL,
  source TEXT NOT NULL,
  confirmation TEXT NOT NULL,
  uncertainty_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drinks_session_time ON drink_events(session_id, consumed_at);
CREATE INDEX IF NOT EXISTS idx_drinks_time ON drink_events(consumed_at);

CREATE TABLE IF NOT EXISTS intervention_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES drinking_sessions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL,
  triggered_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL,
  suppressed_reason TEXT,
  acknowledged_at INTEGER,
  dismissed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_interventions_session ON intervention_events(session_id, triggered_at);

CREATE TABLE IF NOT EXISTS recovery_checkins (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT REFERENCES drinking_sessions(id) ON DELETE SET NULL,
  local_date TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  headache INTEGER, fatigue INTEGER, nausea INTEGER, dizziness INTEGER,
  sleep_quality INTEGER, mental_clarity INTEGER, overall_severity INTEGER, functional_impairment INTEGER,
  ate_before_drinking INTEGER,
  hydration_reported TEXT,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON recovery_checkins(local_date);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  source_name TEXT,
  device_model TEXT,
  quality TEXT NOT NULL,
  sampling_hz REAL,
  context TEXT NOT NULL,
  sleep_stage TEXT,
  external_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_measurements_kind_time ON measurements(kind, start_at);

CREATE TABLE IF NOT EXISTS physiological_baselines (
  kind TEXT NOT NULL,
  context TEXT NOT NULL,
  json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (kind, context)
);

CREATE TABLE IF NOT EXISTS gesture_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT REFERENCES drinking_sessions(id) ON DELETE SET NULL,
  detected_at INTEGER NOT NULL,
  label TEXT NOT NULL,
  confidence REAL NOT NULL,
  model_version TEXT NOT NULL,
  linked_drink_event_id TEXT,
  user_response TEXT
);

CREATE TABLE IF NOT EXISTS model_predictions (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT REFERENCES drinking_sessions(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  predicted_at INTEGER NOT NULL,
  input_quality TEXT NOT NULL,
  feature_availability_json TEXT NOT NULL,
  probability REAL,
  interval_json TEXT,
  status TEXT NOT NULL,
  withheld_reason TEXT
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT,
  client_updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'session_features_and_anomalies',
    sql: `
CREATE TABLE IF NOT EXISTS session_features (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES drinking_sessions(id) ON DELETE CASCADE,
  feature_version TEXT NOT NULL,
  json TEXT NOT NULL,
  data_quality REAL NOT NULL,
  computed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anomaly_events (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  measurement_id TEXT,
  session_id TEXT REFERENCES drinking_sessions(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  robust_z REAL,
  measured_at INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  description TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_time ON anomaly_events(detected_at);
`,
  },
];

export async function migrate(db: SqlDatabase, now: () => number = Date.now): Promise<number[]> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL);',
  );
  const rows = await db.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const ran: number[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(m.sql);
      await db.runAsync('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, now()]);
    });
    ran.push(m.version);
  }
  return ran;
}

export const LATEST_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));
