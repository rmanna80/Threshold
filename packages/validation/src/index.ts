import { z } from 'zod';
import type {
  ConsentRecord,
  DrinkEvent,
  DrinkingSession,
  RecoveryCheckin,
  SyncEnvelope,
  UserGoals,
  UserPreferences,
} from '@threshold/shared-types';

/**
 * Schemas validate every record that crosses a trust boundary (database rows, WatchConnectivity
 * payloads, backend responses, imports). `satisfies z.ZodType<T>` keeps them aligned with the
 * shared TypeScript types at compile time.
 */

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'Invalid UUID');
const epochMs = z.number().int().nonnegative().max(8.64e15);
const tzOffset = z.number().int().min(-14 * 60).max(14 * 60);
const score = z.number().int().min(0).max(10);

export const volumeInputSchema = z.object({
  value: z.number().positive().finite(),
  unit: z.enum(['ml', 'cl', 'l', 'fl_oz_us', 'fl_oz_imp']),
});

export const beverageCategorySchema = z.enum([
  'beer',
  'wine',
  'spirits',
  'cocktail',
  'hard_seltzer',
  'cider',
  'mixed_drink',
  'nonalcoholic',
  'water',
  'custom',
]);

export const drinkEventSchema = z
  .object({
    id: uuid,
    sessionId: uuid,
    beverageId: uuid.nullable(),
    beverageName: z.string().min(1).max(120),
    category: beverageCategorySchema,
    servingInput: volumeInputSchema,
    servingMl: z.number().positive().max(5000),
    fractionConsumed: z.number().gt(0).lte(1),
    abvPercent: z.number().min(0).max(100).nullable(),
    ethanolGrams: z.number().min(0).nullable(),
    standardDrinks: z.number().min(0).nullable(),
    standardDrinkGrams: z.number().positive(),
    isAlcoholic: z.boolean(),
    consumedAt: epochMs,
    loggedAt: epochMs,
    tzOffsetMin: tzOffset,
    source: z.enum(['manual', 'quick_log', 'watch', 'label_scan', 'gesture_assisted', 'imported']),
    confirmation: z.enum(['user_confirmed', 'estimated', 'detected_unconfirmed']),
    uncertainty: z.object({
      abvKnown: z.boolean(),
      volumeKnown: z.boolean(),
      standardDrinksLow: z.number().min(0).nullable(),
      standardDrinksHigh: z.number().min(0).nullable(),
      note: z.string().max(500).nullable(),
    }),
    revision: z.number().int().positive(),
    updatedAt: epochMs,
    deletedAt: epochMs.nullable(),
    deviceId: z.string().min(1).max(100),
  })
  .refine((d) => d.ethanolGrams === null || d.standardDrinks !== null, {
    message: 'standardDrinks must be present when ethanolGrams is known',
    path: ['standardDrinks'],
  }) satisfies z.ZodType<DrinkEvent>;

const measurementSnapshot = z
  .object({ value: z.number().finite(), unit: z.string().max(20), measuredAt: epochMs, source: z.string().max(100) })
  .nullable();

export const drinkingSessionSchema = z.object({
  id: uuid,
  status: z.enum(['active', 'paused', 'ended']),
  startedAt: epochMs,
  endedAt: epochMs.nullable(),
  tzOffsetMin: tzOffset,
  pauses: z.array(z.object({ startedAt: epochMs, endedAt: epochMs.nullable() })).max(200),
  startContext: z.object({
    restingHeartRateBpm: measurementSnapshot,
    hrvSdnnMs: measurementSnapshot,
    lastNightSleepMinutes: measurementSnapshot,
    healthDataAuthorized: z.boolean(),
  }),
  goalSnapshot: z.object({
    maxStandardDrinksPerSession: z.number().min(0).max(30).nullable(),
    paceGoalMinutesBetweenDrinks: z.number().min(15).max(240).nullable(),
  }),
  origin: z.enum(['phone', 'watch', 'auto_prompt']),
  revision: z.number().int().positive(),
  updatedAt: epochMs,
  deletedAt: epochMs.nullable(),
  deviceId: z.string().min(1).max(100),
}) satisfies z.ZodType<DrinkingSession>;

export const userGoalsSchema = z.object({
  objectives: z.array(
    z.enum([
      'reduce_frequency',
      'reduce_per_session',
      'avoid_fast_drinking',
      'improve_recovery',
      'understand_sleep',
      'athletic_recovery',
      'alcohol_free_days',
    ]),
  ),
  maxStandardDrinksPerSession: z.number().min(0).max(30).nullable(),
  maxStandardDrinksPerWeek: z.number().min(0).max(100).nullable(),
  alcoholFreeDaysPerWeek: z.number().int().min(0).max(7).nullable(),
  paceGoalMinutesBetweenDrinks: z.number().int().min(15).max(240).nullable(),
  updatedAt: epochMs,
}) satisfies z.ZodType<UserGoals>;

export const userPreferencesSchema = z.object({
  notificationFrequency: z.enum(['minimal', 'standard', 'frequent']),
  quietMode: z.boolean(),
  standardDrinkRegion: z.enum(['US', 'UK', 'AU', 'NZ', 'CA', 'IE', 'AT', 'CUSTOM']),
  customStandardDrinkGrams: z.number().min(5).max(30).nullable(),
  unitSystem: z.enum(['metric', 'us_customary']),
  drinkingFrequency: z.enum(['rarely', 'monthly', 'weekly', 'several_per_week', 'daily', 'prefer_not_to_say']).nullable(),
  hasAppleWatch: z.boolean().nullable(),
  cloudSyncEnabled: z.boolean(),
  researchParticipation: z.boolean(),
  crashReportingEnabled: z.boolean(),
  automaticDetectionEnabled: z.boolean(),
  emergencyCountry: z.string().length(2),
  dayBoundaryHour: z.number().int().min(0).max(23),
  heightCm: z.number().min(50).max(272).nullable(),
  weightKg: z.number().min(20).max(400).nullable(),
  updatedAt: epochMs,
}) satisfies z.ZodType<UserPreferences>;

export const consentRecordSchema = z.object({
  id: uuid,
  type: z.enum([
    'health_alcohol_data_processing',
    'healthkit',
    'motion',
    'notifications',
    'cloud_sync',
    'research_upload',
    'crash_reporting',
    'automatic_detection',
  ]),
  granted: z.boolean(),
  version: z.string().min(1).max(20),
  recordedAt: epochMs,
}) satisfies z.ZodType<ConsentRecord>;

export const recoveryCheckinSchema = z.object({
  id: uuid,
  sessionId: uuid.nullable(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completedAt: epochMs,
  headache: score.nullable(),
  fatigue: score.nullable(),
  nausea: score.nullable(),
  dizziness: score.nullable(),
  sleepQuality: score.nullable(),
  mentalClarity: score.nullable(),
  overallSeverity: score.nullable(),
  functionalImpairment: score.nullable(),
  ateBeforeDrinking: z.boolean().nullable(),
  hydrationReported: z.enum(['none', 'some', 'regular']).nullable(),
  revision: z.number().int().positive(),
  updatedAt: epochMs,
  deletedAt: epochMs.nullable(),
}) satisfies z.ZodType<RecoveryCheckin>;

export const syncEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  entityType: z.enum([
    'drinking_session',
    'drink_event',
    'recovery_checkin',
    'intervention_event',
    'user_goals',
    'user_preferences',
    'consent_record',
  ]),
  entityId: uuid,
  op: z.enum(['upsert', 'delete']),
  revision: z.number().int().positive(),
  clientUpdatedAt: epochMs,
  deviceId: z.string().min(1).max(100),
  payload: z.unknown().nullable(),
}) satisfies z.ZodType<SyncEnvelope>;

const PAYLOAD_SCHEMAS = {
  drinking_session: drinkingSessionSchema,
  drink_event: drinkEventSchema,
  recovery_checkin: recoveryCheckinSchema,
  user_goals: userGoalsSchema,
  user_preferences: userPreferencesSchema,
  consent_record: consentRecordSchema,
} as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}

/** Validates a sync envelope and, for upserts, its payload against the entity schema. */
export function parseSyncEnvelope(input: unknown): ParseResult<SyncEnvelope> {
  const env = parseWith(syncEnvelopeSchema, input);
  if (!env.ok) return env;
  const e = env.value;
  if (e.op === 'upsert') {
    if (e.entityType === 'intervention_event') return env; // validated by its own module
    const schema = PAYLOAD_SCHEMAS[e.entityType];
    const payload = parseWith(schema as z.ZodType<unknown>, e.payload);
    if (!payload.ok) return { ok: false, error: `payload: ${payload.error}` };
    const id = (payload.value as { id?: string }).id;
    if (id !== undefined && id !== e.entityId) return { ok: false, error: 'payload.id does not match entityId' };
  }
  return env;
}

export { z };
