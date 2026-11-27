# Database schema

## On device — SQLite with SQLCipher (`apps/mobile/database`)

The whole file is encrypted with SQLCipher using a random 256-bit key generated on first launch and
stored in the iOS Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so it is not migrated to other
devices or restored from backups to a different device). Foreign keys are on. Migrations are
append-only and recorded in `schema_migrations`.

### Migration 1 — `initial_schema`

| Table | Key | Purpose |
| --- | --- | --- |
| `kv` | `key` | Small settings (device id, reminder notification ids, research enrolment) |
| `user_profile` | `id = 1` | Eligibility confirmation, onboarding completion |
| `user_preferences` | `id = 1` | `UserPreferences` JSON (validated with zod) |
| `user_goals` | `id = 1` | `UserGoals` JSON |
| `user_consents` | `id` | Append-only consent history; index `(type, recorded_at)` |
| `beverages` | `id` | Saved and recent beverages; ABV nullable with range check; index on `last_used_at` |
| `drinking_sessions` | `id` | Sessions (`status` check), pauses/start context/goal snapshot JSON, `revision`, `deleted_at`, `device_id`; indexes on `started_at`, partial index on `status` |
| `drink_events` | `id` | Drinks; FK `session_id` (cascade); `serving_ml > 0`, `0 < fraction_consumed ≤ 1`; nullable `abv_percent`, `ethanol_grams`, `standard_drinks`; indexes `(session_id, consumed_at)`, `consumed_at` |
| `intervention_events` | `id` | Delivered and suppressed interventions; FK session (cascade) |
| `recovery_checkins` | `id` | Morning check-ins; FK session (set null); index `local_date` |
| `measurements` | `id` | Health sample copies; `external_id` unique (idempotent ingest); index `(kind, start_at)` |
| `physiological_baselines` | `(kind, context)` | Latest `BaselineSummary` JSON |
| `gesture_events` | `id` | Reserved for gesture prompts (unused in this build) |
| `model_predictions` | `id` | Prediction decisions (shown/withheld) |
| `sync_queue` | autoincrement | Outbox; `idempotency_key` unique; status, attempts, backoff; index `(status, next_attempt_at)` |
| `processed_messages` | `message_id` | Watch message ids already applied |

### Migration 2 — `session_features_and_anomalies`

| Table | Key | Purpose |
| --- | --- | --- |
| `session_features` | `session_id` (FK cascade) | `sf-v1` features JSON, version, data quality |
| `anomaly_events` | `id` | Baseline deviations with robust z and description; index `detected_at` |

**Deletion:** `deleteAllLocalData` deletes every table in `USER_DATA_TABLES`, withdraws research
enrolment (deleting recordings), and runs `VACUUM`. The device id is kept so a later cloud-account
deletion can still be attributed.

## Server — PostgreSQL (`backend/app/models`, Alembic `0001_initial_schema`)

| Table | Notes |
| --- | --- |
| `users` | `email` unique, Argon2id `password_hash`, `token_version`, timestamps |
| `refresh_tokens` | SHA-256 `token_hash` unique, device, expiry, revocation; FK user (cascade) |
| `devices` | `(user_id, client_device_id)` unique |
| `drinking_sessions`, `drink_events`, `recovery_checkins`, `intervention_events`, `user_consents`, `user_goals`, `user_preferences` | Synced records: plaintext query columns (ids, user id, status/time/standard drinks/type as needed) plus `revision`, `client_updated_at_ms`, `device_id`, `deleted_at_ms`, and the full record in `payload` (Fernet-encrypted JSON when `THRESHOLD_FIELD_ENCRYPTION_KEY` is set). All FK to `users` with `ON DELETE CASCADE` |
| `sync_events` | Change log with identity `seq` (pull cursor); `(user_id, idempotency_key)` unique |
| `model_versions` | Registry mirror; status ∈ `experimental`, `validated`, `retired`; encrypted validation report |
| `data_export_requests` | Audit of exports |
| `research_uploads` | Consent-linked encrypted research payloads (endpoint disabled by default) |

Naming conventions for constraints are fixed in `app/database/base.py` so migrations are stable.
CI applies the migration to PostgreSQL, runs `alembic check` (models and migrations must match) and
downgrades back to base.

**Plaintext vs encrypted:** columns needed for indexing and integrity checks (e.g. `standard_drinks`,
`consumed_at_ms`, consent `type`) are plaintext in the database; full records are in the encrypted
payload. Database-level encryption at rest (disk/volume) is still required in deployment.
