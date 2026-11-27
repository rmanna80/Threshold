import { buildExportBundle, toCsv } from '@threshold/core';
import type { AppServices } from './container';

/** Tables wiped by "Delete all local data" (schema and migrations are kept). */
export const USER_DATA_TABLES = [
  'session_features',
  'anomaly_events',
  'drink_events',
  'intervention_events',
  'recovery_checkins',
  'gesture_events',
  'model_predictions',
  'drinking_sessions',
  'beverages',
  'measurements',
  'physiological_baselines',
  'sync_queue',
  'processed_messages',
  'user_consents',
  'user_goals',
  'user_preferences',
  'user_profile',
] as const;

export async function collectExport(services: Pick<AppServices, 'repos' | 'clock' | 'deviceId'>, appVersion: string) {
  const { repos, clock } = services;
  const [profile, preferences, goals, consents, sessions, drinks, checkins, interventions, measurements, baselines, sessionFeatures, predictions] = await Promise.all([
    repos.settings.getProfile(),
    repos.settings.getPreferences(),
    repos.settings.getGoals(),
    repos.settings.consentHistory(),
    repos.sessions.listAll(),
    repos.drinks.listAll(),
    repos.checkins.listAll(),
    repos.interventions.listAll(),
    repos.measurements.list(
      ['heart_rate', 'resting_heart_rate', 'hrv_sdnn', 'respiratory_rate', 'sleeping_wrist_temperature', 'sleep_asleep', 'sleep_in_bed', 'sleep_awake'],
      0,
      clock.now(),
    ),
    repos.baselines.listAll(),
    repos.sessionFeatures.listAll(),
    repos.predictions.listAll(),
  ]);
  return buildExportBundle(
    { profile, preferences, goals, consents, sessions, drinks, checkins, interventions, measurements, baselines, sessionFeatures, predictions },
    clock.now(),
    appVersion,
  );
}

export function drinksCsv(drinks: Awaited<ReturnType<AppServices['repos']['drinks']['listAll']>>): string {
  return toCsv(
    drinks.map((d) => ({
      id: d.id,
      session_id: d.sessionId,
      consumed_at_utc: new Date(d.consumedAt).toISOString(),
      tz_offset_min: d.tzOffsetMin,
      beverage: d.beverageName,
      category: d.category,
      serving_value: d.servingInput.value,
      serving_unit: d.servingInput.unit,
      serving_ml: d.servingMl,
      fraction_consumed: d.fractionConsumed,
      abv_percent: d.abvPercent,
      ethanol_grams: d.ethanolGrams,
      standard_drinks: d.standardDrinks,
      standard_drink_grams: d.standardDrinkGrams,
      confirmation: d.confirmation,
      source: d.source,
    })),
    ['id', 'session_id', 'consumed_at_utc', 'tz_offset_min', 'beverage', 'category', 'serving_value', 'serving_unit', 'serving_ml', 'fraction_consumed', 'abv_percent', 'ethanol_grams', 'standard_drinks', 'standard_drink_grams', 'confirmation', 'source'],
  );
}

export function sessionsCsv(sessions: Awaited<ReturnType<AppServices['repos']['sessions']['listAll']>>): string {
  return toCsv(
    sessions.map((s) => ({
      id: s.id,
      started_at_utc: new Date(s.startedAt).toISOString(),
      ended_at_utc: s.endedAt ? new Date(s.endedAt).toISOString() : '',
      tz_offset_min: s.tzOffsetMin,
      status: s.status,
      origin: s.origin,
      goal_standard_drinks: s.goalSnapshot.maxStandardDrinksPerSession,
    })),
    ['id', 'started_at_utc', 'ended_at_utc', 'tz_offset_min', 'status', 'origin', 'goal_standard_drinks'],
  );
}

export function checkinsCsv(checkins: Awaited<ReturnType<AppServices['repos']['checkins']['listAll']>>): string {
  return toCsv(
    checkins.map((c) => ({
      id: c.id,
      session_id: c.sessionId,
      local_date: c.localDate,
      overall_severity: c.overallSeverity,
      sleep_quality: c.sleepQuality,
      headache: c.headache,
      fatigue: c.fatigue,
      nausea: c.nausea,
      dizziness: c.dizziness,
      mental_clarity: c.mentalClarity,
      functional_impairment: c.functionalImpairment,
    })),
    ['id', 'session_id', 'local_date', 'overall_severity', 'sleep_quality', 'headache', 'fatigue', 'nausea', 'dizziness', 'mental_clarity', 'functional_impairment'],
  );
}

/** Irreversibly removes all user data from the local database. */
export async function deleteAllLocalData(services: Pick<AppServices, 'db'> & Partial<Pick<AppServices, 'research'>>): Promise<void> {
  // Research recordings live as files, not rows: delete them (and stop accepting new ones) first.
  await services.research?.withdraw();
  await services.db.withTransactionAsync(async () => {
    for (const t of USER_DATA_TABLES) await services.db.execAsync(`DELETE FROM ${t};`);
  });
  // Device id is kept so a future cloud account deletion request can still be attributed.
  await services.db.execAsync('VACUUM;');
}
