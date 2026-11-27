# Data dictionary

Conventions: timestamps are UTC epoch milliseconds (`EpochMs`); `tzOffsetMin` is minutes east of UTC
at the time of the event; ids are UUID v4; `revision` increases on every edit; `deletedAt` marks a
tombstone (kept so deletions sync). Types live in `packages/shared-types/src/index.ts`; validation in
`packages/validation`.

Sensitivity: **H** = health/alcohol data (special category in many jurisdictions), **P** = personal,
**T** = technical. "Synced" means eligible for optional cloud sync when the user enables it.
"Export" means included in the JSON export.

## Drinking session — `DrinkingSession` (H, synced, export)

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `active` \| `paused` \| `ended` | Lifecycle state |
| `startedAt`, `endedAt` | EpochMs | Start; end (null while open) |
| `pauses` | `{startedAt, endedAt}`[] | Paused intervals (excluded from active duration) |
| `startContext` | object | Real, timestamped readings at start (resting HR, HRV SDNN, last-night sleep) and whether Health access was in use. Null values mean no reading, never zero. These Health-derived values sync with the session when cloud sync is on |
| `goalSnapshot` | object | Session goal and pace goal in force when the session started |
| `origin` | `phone` \| `watch` \| `auto_prompt` | Where it was started |
| `deviceId` | string | Install-scoped random id of the device that last wrote it |

## Drink — `DrinkEvent` (H, synced, export)

| Field | Type | Meaning |
| --- | --- | --- |
| `beverageName`, `category` | string, enum | `beer`, `wine`, `spirits`, `cocktail`, `hard_seltzer`, `cider`, `mixed_drink`, `nonalcoholic`, `water`, `custom` |
| `servingInput` | `{value, unit}` | Exactly what the user entered (`ml`, `cl`, `l`, `fl_oz_us`, `fl_oz_imp`) |
| `servingMl` | number | Normalised volume |
| `fractionConsumed` | (0, 1] | Portion actually drunk |
| `abvPercent` | number \| null | Alcohol by volume; null if unknown |
| `ethanolGrams` | number \| null | servingMl × fraction × ABV/100 × 0.789; null if not computable |
| `standardDrinks` | number \| null | ethanolGrams / standardDrinkGrams; null if unknown |
| `standardDrinkGrams` | number | Definition in force when logged (e.g. 14 US) |
| `isAlcoholic` | boolean | False for water and non-alcoholic drinks |
| `consumedAt`, `loggedAt` | EpochMs | When drunk; when recorded |
| `source` | enum | `manual`, `quick_log`, `watch`, `label_scan`, … |
| `confirmation` | `user_confirmed` \| `estimated` \| `detected_unconfirmed` | Only the first two count toward totals |
| `uncertainty` | object | Whether ABV/volume were known; optional user range; note |

## Beverage — `Beverage` (P, local only, export)

Saved/recent drinks: name, category, default serving, ABV (nullable), `abvVaries`, usage counts.

## Intervention — `InterventionEvent` (H, synced, export)

`category`, `messageKey`, `title`, `body`, `priority` (1 highest), `dedupeKey`, `triggeredAt`,
`delivered`, `suppressedReason` (`quiet_mode`, `frequency_preference`, `session_cap`, `delivered_on_watch`,
…), `acknowledgedAt`, `dismissed`.

## Recovery check-in — `RecoveryCheckin` (H, synced, export)

`sessionId` (nullable), `localDate`, `completedAt`; symptom scores 0–10 (integers, all optional):
`headache`, `fatigue`, `nausea`, `dizziness`, `sleepQuality` (0 = very poor, 10 = excellent),
`mentalClarity` (0 = very foggy, 10 = clear), `overallSeverity`, `functionalImpairment` (0 = no impact);
`ateBeforeDrinking` (bool), `hydrationReported` (`none` \| `some` \| `regular`).

## Goals and preferences (P, synced, export)

`UserGoals`: objectives, per-session and weekly personal goals (standard drinks), alcohol-free days per
week, pace goal (minutes between drinks). Personal targets — never safety thresholds.

`UserPreferences`: notification frequency (`minimal` \| `standard` \| `frequent`), quiet mode,
standard-drink region (`US`, `UK`, `AU`, `NZ`, `CA`, `IE`, `AT`, `CUSTOM`) and custom grams, unit
system, drinking frequency (optional), Apple Watch ownership, cloud sync, research participation,
crash reporting, automatic detection, emergency country, day-boundary hour, optional height/weight
(not used for any BAC estimate).

## Consent — `ConsentRecord` (P, synced, export)

Append-only history: `type` (`health_alcohol_data_processing`, `healthkit`, `motion`, `notifications`,
`cloud_sync`, `research_upload`, `research_recording`, `crash_reporting`, `automatic_detection`),
`granted`, `version` of the text shown, `recordedAt`.

## Measurement — `Measurement` (H, local only, export)

Copies of Apple Health samples: `kind`, `value`, `unit`, `startAt`, `endAt`, `provider`
(`healthkit`, `watch_sensor`, `external_device`, `manual`), `sourceName`, `deviceModel`, `quality`,
`samplingHz`, `context` (`resting`, `active`, `sleep`, `unknown`), `sleepStage`, `externalId` (Health
sample id for idempotent ingestion).

## Baseline — `BaselineSummary` (H, local only, export)

Per kind/context: median, MAD, EWMA, p10, p90, sample count, distinct days, first/last sample times,
maturity (`insufficient` \| `developing` \| `established`), computed time, unit.

## Anomaly event (H, local only)

Deviation records: kind, measurement id, session id, direction, robust z, measured/detected times,
plain-language description.

## Session features — `SessionFeatures` (H, local only, export)

Spec `sf-v1`; 24 numeric-or-null values (see `packages/core/src/sessionFeatures.ts` for exact
definitions), group availability (`drinks`, `strength`, `history`, `sleep`, `physiology`), `dataQuality`
0–1 and `inputQuality` (`high` ≥ 0.75, `medium` ≥ 0.5, else `low`).

## Model prediction — `ModelPrediction` (H, local only, export)

One row per session × model version: `modelId`, `modelVersion`, `predictedAt`, `inputQuality`,
`featureAvailability`, `probability` and `interval` (null when withheld), `status` (`shown` \|
`withheld`), `withheldReason`.

## Gesture event (H, local only)

Table exists for future gesture prompts (`label`, `confidence`, `modelVersion`, `userResponse`, linked
drink). Nothing writes to it in this build because gesture prompts are disabled.

## Research recording (H, research builds only, on device, never uploaded by the app)

JSONL file per recording (format in `SENSOR_PROCESSING.md`): study code, protocol id, activity label,
dominant hand, wrist and crown side, device model, OS version, 50 Hz motion samples, dropped-sample
estimate. Enrolment (study code, dominant hand, recorder switch) is stored in the local key-value
table. Withdrawal deletes all recordings on the phone.

## Technical records (T, local only)

`sync_queue` (outbox), `processed_messages` (watch message ids already applied), `kv` (device id,
reminder ids, research enrolment), `schema_migrations`.

## Backend

The server stores accounts (email, Argon2id password hash), refresh-token hashes, devices, and the
synced entities above as encrypted JSON payloads with a few plaintext columns needed for querying
(ids, user id, revision, timestamps, deletion markers). See `DATABASE_SCHEMA.md`.
