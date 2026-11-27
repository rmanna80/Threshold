import type { BeverageCategory, ConfirmationState, EpochMs, TzOffsetMin } from '@threshold/shared-types';
import { MATURITY_RULES, mad, maturityFor, median, robustZ, type BaselineSample, type NightSummary } from './baselines';
import { DAY_MS, HOUR_MS, MINUTE_MS, localDateKey, weekdayIndex } from './time';

/**
 * Session feature specification `sf-v1`.
 *
 * Features describe one evening as it is known the next morning, BEFORE the recovery check-in.
 * Nothing reported in the check-in (food, hydration, symptoms) is used as an input, so features
 * never leak the outcome they are meant to help predict.
 *
 * The same specification is implemented in Python (intelligence/recovery_prediction/features.py)
 * and both are checked against packages/core/test-vectors/session_features.json.
 * Unknown values are `null` — never imputed here. Models handle missingness explicitly.
 */
export const SESSION_FEATURE_VERSION = 'sf-v1';

export const SESSION_FEATURE_NAMES = [
  'n_drinks',
  'n_unknown_strength',
  'unknown_fraction',
  'std_drinks_known',
  'n_non_alcoholic',
  'duration_min',
  'drinking_span_min',
  'mean_gap_min',
  'peak_std_30min',
  'peak_std_60min',
  'max_drinks_30min',
  'start_local_hour',
  'last_drink_local_hour',
  'weekend_night',
  'spirits_share',
  'prior_7d_std_drinks',
  'prior_7d_sessions',
  'days_since_previous_session',
  'sleep_asleep_min',
  'sleep_efficiency',
  'sleep_interruptions',
  'sleep_onset_after_last_drink_min',
  'resting_hr_delta_bpm',
  'hrv_robust_z',
] as const;

export type SessionFeatureName = (typeof SESSION_FEATURE_NAMES)[number];

export interface FeatureDrink {
  consumedAt: EpochMs;
  standardDrinks: number | null;
  isAlcoholic: boolean;
  category: BeverageCategory;
  confirmation: ConfirmationState;
  deletedAt: EpochMs | null;
}

export interface FeatureSession {
  startedAt: EpochMs;
  endedAt: EpochMs | null;
  tzOffsetMin: TzOffsetMin;
}

export interface SessionFeatureInput {
  session: FeatureSession;
  drinks: readonly FeatureDrink[];
  /** Drinks from OTHER sessions; only those in the 7 days before this session are used. Omit if history is unavailable. */
  priorDrinks?: readonly FeatureDrink[] | null;
  /** Start times of OTHER (non-deleted) sessions. Omit if history is unavailable. */
  priorSessionStarts?: readonly EpochMs[] | null;
  /** Sleep for the night after the session (from summarizeSleep). */
  sleep?: Pick<NightSummary, 'asleepMinutes' | 'inBedMinutes' | 'interruptions' | 'sleepStart'> | null;
  /** Overnight resting heart rate minus the personal baseline median (bpm). */
  restingHrDeltaBpm?: number | null;
  /** Overnight HRV robust z-score against the personal baseline. */
  hrvRobustZ?: number | null;
}

export type FeatureGroup = 'drinks' | 'strength' | 'history' | 'sleep' | 'physiology';

export interface SessionFeatures {
  version: typeof SESSION_FEATURE_VERSION;
  values: Record<SessionFeatureName, number | null>;
  availability: Record<FeatureGroup, boolean>;
  /** 0–1: mean of strength-known fraction, history, sleep and physiology availability. */
  dataQuality: number;
  inputQuality: 'high' | 'medium' | 'low';
}

const SPIRIT_LIKE: ReadonlySet<BeverageCategory> = new Set(['spirits', 'cocktail', 'mixed_drink']);

/** Rounded to 6 decimals so TypeScript and Python agree exactly. */
function r6(x: number): number {
  const v = Math.round(x * 1e6) / 1e6;
  return Object.is(v, -0) ? 0 : v;
}

function counts(d: FeatureDrink): boolean {
  return d.deletedAt === null && d.isAlcoholic && d.confirmation !== 'detected_unconfirmed';
}

function localHour(at: EpochMs, tz: TzOffsetMin): number {
  const local = at + tz * MINUTE_MS;
  return (((local % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
}

/** Local midnight (as UTC ms in the local frame) of the calendar day containing `at`. */
function localMidnight(at: EpochMs, tz: TzOffsetMin): number {
  const local = at + tz * MINUTE_MS;
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
}

function peak(times: readonly number[], weights: readonly number[], windowMs: number): number {
  let best = 0;
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < times.length; i++) {
    sum += weights[i] ?? 0;
    while ((times[lo] ?? 0) <= (times[i] ?? 0) - windowMs) {
      sum -= weights[lo] ?? 0;
      lo++;
    }
    best = Math.max(best, sum);
  }
  return best;
}

export function buildSessionFeatures(input: SessionFeatureInput): SessionFeatures {
  const { session } = input;
  const tz = session.tzOffsetMin;
  const alcoholic = input.drinks.filter(counts).sort((a, b) => a.consumedAt - b.consumedAt);
  const times = alcoholic.map((d) => d.consumedAt);
  const n = alcoholic.length;
  const nUnknown = alcoholic.filter((d) => d.standardDrinks === null).length;
  const known = alcoholic.map((d) => d.standardDrinks ?? 0);
  const stdKnown = known.reduce((a, b) => a + b, 0);
  const first = times[0] ?? null;
  const last = times[n - 1] ?? null;
  const span = first !== null && last !== null ? (last - first) / MINUTE_MS : null;
  const end = session.endedAt ?? last;

  const spiritStd = alcoholic.reduce((a, d) => a + (SPIRIT_LIKE.has(d.category) ? (d.standardDrinks ?? 0) : 0), 0);

  const hasHistory = input.priorDrinks != null && input.priorSessionStarts != null;
  const weekAgo = session.startedAt - 7 * DAY_MS;
  let prior7Std: number | null = null;
  let prior7Sessions: number | null = null;
  let daysSincePrev: number | null = null;
  if (hasHistory) {
    prior7Std = (input.priorDrinks ?? [])
      .filter((d) => counts(d) && d.consumedAt >= weekAgo && d.consumedAt < session.startedAt)
      .sort((a, b) => a.consumedAt - b.consumedAt)
      .reduce((a, d) => a + (d.standardDrinks ?? 0), 0);
    const earlier = (input.priorSessionStarts ?? []).filter((t) => t < session.startedAt);
    prior7Sessions = earlier.filter((t) => t >= weekAgo).length;
    daysSincePrev = earlier.length ? (session.startedAt - Math.max(...earlier)) / DAY_MS : null;
  }

  const sleep = input.sleep ?? null;
  const rhr = input.restingHrDeltaBpm ?? null;
  const hrv = input.hrvRobustZ ?? null;
  const night = weekdayIndex(localDateKey(session.startedAt, tz, 6));

  const raw: Record<SessionFeatureName, number | null> = {
    n_drinks: n,
    n_unknown_strength: nUnknown,
    unknown_fraction: n ? nUnknown / n : null,
    std_drinks_known: stdKnown,
    n_non_alcoholic: input.drinks.filter((d) => d.deletedAt === null && !d.isAlcoholic).length,
    duration_min: end !== null ? Math.max(0, end - session.startedAt) / MINUTE_MS : null,
    drinking_span_min: span,
    mean_gap_min: span !== null && n >= 2 ? span / (n - 1) : null,
    peak_std_30min: peak(times, known, 30 * MINUTE_MS),
    peak_std_60min: peak(times, known, 60 * MINUTE_MS),
    max_drinks_30min: peak(times, times.map(() => 1), 30 * MINUTE_MS),
    start_local_hour: localHour(session.startedAt, tz),
    last_drink_local_hour: last !== null ? (last + tz * MINUTE_MS - localMidnight(session.startedAt, tz)) / HOUR_MS : null,
    weekend_night: night === 4 || night === 5 ? 1 : 0,
    spirits_share: stdKnown > 0 ? spiritStd / stdKnown : null,
    prior_7d_std_drinks: prior7Std,
    prior_7d_sessions: prior7Sessions,
    days_since_previous_session: daysSincePrev,
    sleep_asleep_min: sleep ? sleep.asleepMinutes : null,
    sleep_efficiency: sleep && sleep.inBedMinutes > 0 ? Math.min(1, sleep.asleepMinutes / sleep.inBedMinutes) : null,
    sleep_interruptions: sleep ? sleep.interruptions : null,
    sleep_onset_after_last_drink_min: sleep?.sleepStart != null && last !== null ? (sleep.sleepStart - last) / MINUTE_MS : null,
    resting_hr_delta_bpm: rhr,
    hrv_robust_z: hrv,
  };
  const values = Object.fromEntries(SESSION_FEATURE_NAMES.map((k) => [k, raw[k] === null ? null : r6(raw[k])])) as Record<SessionFeatureName, number | null>;

  const availability: Record<FeatureGroup, boolean> = {
    drinks: n > 0,
    strength: nUnknown === 0,
    history: hasHistory,
    sleep: sleep !== null,
    physiology: rhr !== null || hrv !== null,
  };
  const strengthKnown = n ? 1 - nUnknown / n : 1;
  const dataQuality = r6((strengthKnown + (hasHistory ? 1 : 0) + (sleep ? 1 : 0) + (availability.physiology ? 1 : 0)) / 4);
  return {
    version: SESSION_FEATURE_VERSION,
    values,
    availability,
    dataQuality,
    inputQuality: dataQuality >= 0.75 ? 'high' : dataQuality >= 0.5 ? 'medium' : 'low',
  };
}

// ---------------------------------------------------------------------------
// Input assembly (shared rules for the app and the research pipeline)
// ---------------------------------------------------------------------------

const SLEEP_SEARCH_MS = 18 * HOUR_MS;

/**
 * The sleep that follows a session: the earliest night whose sleep starts at or after the last
 * drink (or the session start when nothing was drunk) and no later than 18 h after the session
 * ended. Returns null when there is no such night.
 */
export function nightAfterSession<T extends Pick<NightSummary, 'sleepStart'>>(nights: readonly T[], session: FeatureSession, lastDrinkAt: EpochMs | null): T | null {
  const from = lastDrinkAt ?? session.startedAt;
  const to = (session.endedAt ?? lastDrinkAt ?? session.startedAt) + SLEEP_SEARCH_MS;
  let best: T | null = null;
  for (const n of nights) {
    if (n.sleepStart === null || n.sleepStart < from || n.sleepStart > to) continue;
    if (best === null || n.sleepStart < (best.sleepStart ?? Infinity)) best = n;
  }
  return best;
}

export interface OvernightPhysiology {
  restingHrDeltaBpm: number | null;
  hrvRobustZ: number | null;
}

function baselineOf(samples: readonly BaselineSample[], before: EpochMs, kind: 'resting_heart_rate' | 'hrv_sdnn') {
  const rule = MATURITY_RULES[kind];
  if (!rule) return null;
  const from = before - rule.windowDays * DAY_MS;
  const usable = samples.filter((s) => Number.isFinite(s.value) && s.at >= from && s.at < before);
  const days = new Set(usable.map((s) => localDateKey(s.at, s.tzOffsetMin))).size;
  if (maturityFor(usable.length, days, rule) === 'insufficient') return null;
  const values = usable.map((s) => s.value);
  return { median: median(values), mad: mad(values) };
}

/**
 * Overnight physiology relative to the personal baseline from the 28 days before the session.
 * Baselines below "developing" maturity (MATURITY_RULES) give null rather than a shaky number.
 *  - Resting HR: first resting-HR sample between sleep start and 12 h after waking, minus the
 *    baseline median.
 *  - HRV: median SDNN of samples during sleep, as a robust z against the baseline.
 */
export function overnightPhysiology(params: {
  sessionStartedAt: EpochMs;
  sleep: Pick<NightSummary, 'sleepStart' | 'sleepEnd'> | null;
  restingHr: readonly BaselineSample[];
  hrv: readonly BaselineSample[];
}): OvernightPhysiology {
  const { sleep } = params;
  if (!sleep || sleep.sleepStart === null || sleep.sleepEnd === null) return { restingHrDeltaBpm: null, hrvRobustZ: null };
  const { sleepStart, sleepEnd } = sleep;
  let rhrDelta: number | null = null;
  const rhrBase = baselineOf(params.restingHr, params.sessionStartedAt, 'resting_heart_rate');
  const rhrNight = [...params.restingHr].filter((s) => s.at >= sleepStart && s.at <= sleepEnd + 12 * HOUR_MS).sort((a, b) => a.at - b.at)[0];
  if (rhrBase?.median != null && rhrNight) rhrDelta = r6(rhrNight.value - rhrBase.median);

  let hrvZ: number | null = null;
  const hrvBase = baselineOf(params.hrv, params.sessionStartedAt, 'hrv_sdnn');
  const night = median(params.hrv.filter((s) => s.at >= sleepStart && s.at <= sleepEnd).map((s) => s.value));
  if (hrvBase && night !== null) {
    const z = robustZ(night, hrvBase.median, hrvBase.mad);
    hrvZ = z === null ? null : r6(z);
  }
  return { restingHrDeltaBpm: rhrDelta, hrvRobustZ: hrvZ };
}
