/**
 * Threshold domain types.
 *
 * Conventions:
 *  - All identifiers are UUID v4 strings.
 *  - All instants are UTC epoch milliseconds (`EpochMs`). Local-day attribution uses the
 *    timezone offset captured at the moment of the event (`tzOffsetMin`), so travel and
 *    DST changes never re-bucket historical data.
 *  - Units are always explicit in field names (`servingMl`, `ethanolGrams`, ...).
 *  - Original user input is preserved next to normalized values.
 */

export type UUID = string;
export type EpochMs = number;
/** Minutes east of UTC at the time of the event (e.g. New York in winter = -300). */
export type TzOffsetMin = number;
/** Local calendar date, `YYYY-MM-DD`. */
export type LocalDateKey = string;

// ---------------------------------------------------------------------------
// Units & regions
// ---------------------------------------------------------------------------

export type VolumeUnit = 'ml' | 'cl' | 'l' | 'fl_oz_us' | 'fl_oz_imp';

export interface VolumeInput {
  value: number;
  unit: VolumeUnit;
}

/** Regions with a governmental standard drink definition supported by Threshold. */
export type StandardDrinkRegion = 'US' | 'UK' | 'AU' | 'NZ' | 'CA' | 'IE' | 'AT' | 'CUSTOM';

export interface StandardDrinkDefinition {
  region: StandardDrinkRegion;
  /** Grams of pure ethanol in one standard drink / unit. */
  gramsEthanol: number;
  /** Display label, e.g. "standard drink" (US) or "unit" (UK). */
  label: string;
  labelPlural: string;
  source: string;
}

export type UnitSystem = 'metric' | 'us_customary';

// ---------------------------------------------------------------------------
// Beverages & drink events
// ---------------------------------------------------------------------------

export type BeverageCategory =
  | 'beer'
  | 'wine'
  | 'spirits'
  | 'cocktail'
  | 'hard_seltzer'
  | 'cider'
  | 'mixed_drink'
  | 'nonalcoholic'
  | 'water'
  | 'custom';

export interface Beverage {
  id: UUID;
  name: string;
  category: BeverageCategory;
  defaultServing: VolumeInput;
  /** Alcohol by volume in percent (5 = 5%). `null` means unknown — never assumed. */
  abvPercent: number | null;
  isCustom: boolean;
  /** Typical ABV varies widely for this item (e.g. house cocktails). */
  abvVaries: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  lastUsedAt: EpochMs | null;
  useCount: number;
}

export type DataSource =
  | 'manual'
  | 'quick_log'
  | 'watch'
  | 'label_scan'
  | 'gesture_assisted'
  | 'imported';

/**
 * - `user_confirmed`: the user explicitly recorded or confirmed this drink.
 * - `estimated`: the user recorded a drink but alcohol content is an estimate/range.
 * - `detected_unconfirmed`: produced by a detector (gesture) and NOT confirmed. Never counted
 *   in consumption totals.
 */
export type ConfirmationState = 'user_confirmed' | 'estimated' | 'detected_unconfirmed';

export interface DrinkUncertainty {
  abvKnown: boolean;
  volumeKnown: boolean;
  /** For estimated drinks, a user-supplied standard-drink range. */
  standardDrinksLow: number | null;
  standardDrinksHigh: number | null;
  note: string | null;
}

export interface DrinkEvent {
  id: UUID;
  sessionId: UUID;
  beverageId: UUID | null;
  beverageName: string;
  category: BeverageCategory;
  /** Exactly what the user entered. */
  servingInput: VolumeInput;
  /** Normalized serving volume in millilitres. */
  servingMl: number;
  /** Portion of the serving consumed, 0 < f <= 1. */
  fractionConsumed: number;
  abvPercent: number | null;
  /** Pure ethanol in grams for the consumed portion; `null` if not computable. */
  ethanolGrams: number | null;
  /** Standard drinks under `standardDrinkGrams`; `null` if not computable. */
  standardDrinks: number | null;
  /** Grams-per-standard-drink definition in force when logged. */
  standardDrinkGrams: number;
  isAlcoholic: boolean;
  consumedAt: EpochMs;
  loggedAt: EpochMs;
  tzOffsetMin: TzOffsetMin;
  source: DataSource;
  confirmation: ConfirmationState;
  uncertainty: DrinkUncertainty;
  /** Monotonic revision for conflict resolution; incremented on every edit. */
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
  /** Device that last wrote the record. */
  deviceId: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'paused' | 'ended';

export interface PauseInterval {
  startedAt: EpochMs;
  endedAt: EpochMs | null;
}

/** Physiological context captured when a session starts (only real, timestamped values). */
export interface SessionStartContext {
  restingHeartRateBpm: MeasurementSnapshot | null;
  hrvSdnnMs: MeasurementSnapshot | null;
  lastNightSleepMinutes: MeasurementSnapshot | null;
  healthDataAuthorized: boolean;
}

export interface MeasurementSnapshot {
  value: number;
  unit: string;
  measuredAt: EpochMs;
  source: string;
}

export interface SessionGoalSnapshot {
  maxStandardDrinksPerSession: number | null;
  paceGoalMinutesBetweenDrinks: number | null;
}

export interface DrinkingSession {
  id: UUID;
  status: SessionStatus;
  startedAt: EpochMs;
  endedAt: EpochMs | null;
  tzOffsetMin: TzOffsetMin;
  pauses: PauseInterval[];
  startContext: SessionStartContext;
  goalSnapshot: SessionGoalSnapshot;
  origin: 'phone' | 'watch' | 'auto_prompt';
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
  deviceId: string;
}

// ---------------------------------------------------------------------------
// Users, goals, preferences, consent
// ---------------------------------------------------------------------------

export type ModerationObjective =
  | 'reduce_frequency'
  | 'reduce_per_session'
  | 'avoid_fast_drinking'
  | 'improve_recovery'
  | 'understand_sleep'
  | 'athletic_recovery'
  | 'alcohol_free_days';

export interface UserGoals {
  objectives: ModerationObjective[];
  /** Personal goal — NOT a safety threshold. */
  maxStandardDrinksPerSession: number | null;
  maxStandardDrinksPerWeek: number | null;
  alcoholFreeDaysPerWeek: number | null;
  /** Personal pacing preference used only to trigger reminders. Never shown as a countdown. */
  paceGoalMinutesBetweenDrinks: number | null;
  updatedAt: EpochMs;
}

export type NotificationFrequency = 'minimal' | 'standard' | 'frequent';
export type DrinkingFrequency =
  | 'rarely'
  | 'monthly'
  | 'weekly'
  | 'several_per_week'
  | 'daily'
  | 'prefer_not_to_say';

export interface UserPreferences {
  notificationFrequency: NotificationFrequency;
  /** No notifications at all during sessions except user-requested reminders. */
  quietMode: boolean;
  standardDrinkRegion: StandardDrinkRegion;
  customStandardDrinkGrams: number | null;
  unitSystem: UnitSystem;
  drinkingFrequency: DrinkingFrequency | null;
  hasAppleWatch: boolean | null;
  cloudSyncEnabled: boolean;
  researchParticipation: boolean;
  crashReportingEnabled: boolean;
  automaticDetectionEnabled: boolean;
  /** ISO 3166-1 alpha-2 country used for emergency numbers. */
  emergencyCountry: string;
  /** Hour (0-23) at which a new "drinking day" begins for daily attribution. */
  dayBoundaryHour: number;
  heightCm: number | null;
  weightKg: number | null;
  updatedAt: EpochMs;
}

export type ConsentType =
  | 'health_alcohol_data_processing'
  | 'healthkit'
  | 'motion'
  | 'notifications'
  | 'cloud_sync'
  | 'research_upload'
  | 'crash_reporting'
  | 'automatic_detection';

export interface ConsentRecord {
  id: UUID;
  type: ConsentType;
  granted: boolean;
  /** Version of the consent text the user saw. */
  version: string;
  recordedAt: EpochMs;
}

export interface EligibilityRecord {
  confirmedLegalAge: boolean;
  country: string;
  legalDrinkingAge: number;
  confirmedAt: EpochMs;
}

// ---------------------------------------------------------------------------
// Measurements & baselines
// ---------------------------------------------------------------------------

export type MeasurementKind =
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv_sdnn'
  | 'respiratory_rate'
  | 'sleeping_wrist_temperature'
  | 'walking_steadiness'
  | 'sleep_asleep'
  | 'sleep_in_bed'
  | 'sleep_awake'
  | 'active_energy'
  | 'resting_energy'
  | 'step_count';

export type MeasurementProvider = 'healthkit' | 'watch_sensor' | 'external_device' | 'manual';
export type MeasurementQuality = 'good' | 'fair' | 'poor' | 'unknown';
export type MeasurementContext = 'resting' | 'active' | 'sleep' | 'unknown';

export interface Measurement {
  id: UUID;
  kind: MeasurementKind;
  value: number;
  unit: string;
  startAt: EpochMs;
  endAt: EpochMs;
  provider: MeasurementProvider;
  sourceName: string | null;
  deviceModel: string | null;
  quality: MeasurementQuality;
  samplingHz: number | null;
  context: MeasurementContext;
  /** Optional sleep stage for sleep_asleep samples. */
  sleepStage?: 'core' | 'deep' | 'rem' | 'unspecified' | null;
  /** External id (e.g. HealthKit sample UUID) for idempotent ingestion. */
  externalId: string | null;
}

export type Availability = 'available' | 'not_authorized' | 'not_supported' | 'no_data';

export type BaselineMaturity = 'insufficient' | 'developing' | 'established';

export interface BaselineSummary {
  kind: MeasurementKind;
  context: MeasurementContext;
  median: number | null;
  mad: number | null;
  ewma: number | null;
  p10: number | null;
  p90: number | null;
  sampleCount: number;
  distinctDays: number;
  firstSampleAt: EpochMs | null;
  lastSampleAt: EpochMs | null;
  maturity: BaselineMaturity;
  computedAt: EpochMs;
  unit: string;
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

export type InterventionCategory =
  | 'consumption_pace'
  | 'personal_goal'
  | 'nonalcoholic_alternative'
  | 'physiological_change'
  | 'recovery_awareness'
  | 'session_closure';

export type InterventionPriority = 1 | 2 | 3; // 1 = highest

export interface InterventionEvent {
  id: UUID;
  sessionId: UUID;
  category: InterventionCategory;
  messageKey: string;
  title: string;
  body: string;
  priority: InterventionPriority;
  dedupeKey: string;
  triggeredAt: EpochMs;
  delivered: boolean;
  suppressedReason: string | null;
  acknowledgedAt: EpochMs | null;
  dismissed: boolean;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type SymptomScore = number; // 0..10 integer

export interface RecoveryCheckin {
  id: UUID;
  sessionId: UUID | null;
  localDate: LocalDateKey;
  completedAt: EpochMs;
  headache: SymptomScore | null;
  fatigue: SymptomScore | null;
  nausea: SymptomScore | null;
  dizziness: SymptomScore | null;
  /** 0 = very poor, 10 = excellent. */
  sleepQuality: SymptomScore | null;
  /** 0 = very foggy, 10 = completely clear. */
  mentalClarity: SymptomScore | null;
  overallSeverity: SymptomScore | null;
  /** 0 = no impact on normal activities, 10 = unable to do normal activities. */
  functionalImpairment: SymptomScore | null;
  ateBeforeDrinking: boolean | null;
  hydrationReported: 'none' | 'some' | 'regular' | null;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

// ---------------------------------------------------------------------------
// Gestures (research only)
// ---------------------------------------------------------------------------

export type ActivityLabel =
  | 'drinking_like'
  | 'eating'
  | 'phone_use'
  | 'face_touch'
  | 'walking'
  | 'talking_gestures'
  | 'sitting'
  | 'exercise'
  | 'other'
  | 'unknown';

export interface GestureEvent {
  id: UUID;
  sessionId: UUID | null;
  detectedAt: EpochMs;
  label: ActivityLabel;
  confidence: number;
  modelVersion: string;
  /** Detected gestures are never consumption. A user may link one to a confirmed drink. */
  linkedDrinkEventId: UUID | null;
  userResponse: 'confirmed_drink' | 'not_a_drink' | 'ignored' | null;
}

// ---------------------------------------------------------------------------
// Models & predictions
// ---------------------------------------------------------------------------

export type ModelStatus = 'experimental' | 'validated' | 'retired';

export interface ModelVersionInfo {
  modelId: string;
  version: string;
  status: ModelStatus;
  task: 'gesture_classification' | 'recovery_risk';
  validationReportId: string | null;
  createdAt: EpochMs;
}

export interface ModelPrediction {
  id: UUID;
  sessionId: UUID | null;
  modelId: string;
  modelVersion: string;
  predictedAt: EpochMs;
  inputQuality: 'high' | 'medium' | 'low';
  featureAvailability: Record<string, boolean>;
  probability: number | null;
  interval: [number, number] | null;
  status: 'shown' | 'withheld';
  withheldReason: string | null;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncEntityType =
  | 'drinking_session'
  | 'drink_event'
  | 'recovery_checkin'
  | 'intervention_event'
  | 'user_goals'
  | 'user_preferences'
  | 'consent_record';

export interface SyncEnvelope<TPayload = unknown> {
  idempotencyKey: string;
  entityType: SyncEntityType;
  entityId: UUID;
  op: 'upsert' | 'delete';
  revision: number;
  clientUpdatedAt: EpochMs;
  deviceId: string;
  payload: TPayload | null;
}

export interface SyncAck {
  idempotencyKey: string;
  status: 'applied' | 'duplicate' | 'stale' | 'rejected';
  serverRevision: number;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export type Result<T> = { ok: true; value: T; warnings: ValidationIssue[] } | { ok: false; errors: ValidationIssue[] };
