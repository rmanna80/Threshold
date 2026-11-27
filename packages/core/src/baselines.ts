import type {
  BaselineMaturity,
  BaselineSummary,
  EpochMs,
  LocalDateKey,
  Measurement,
  MeasurementContext,
  MeasurementKind,
} from '@threshold/shared-types';
import { assertSafeMessage } from './safety';
import { DAY_MS, HOUR_MS, MINUTE_MS, formatAge, localDateKey } from './time';
import { roundTo } from './units';

/**
 * Personal physiological baselines with robust statistics. Every function guards against empty
 * input, division by zero and insufficient samples, and baselines carry a maturity indicator so
 * the UI never presents an immature baseline as meaningful.
 *
 *   EWMA_t   = α · x_t + (1 − α) · EWMA_{t−1}
 *   robust_z = 0.6745 · (x − median) / MAD
 */

export function median(values: readonly number[]): number | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? (xs[mid] as number) : ((xs[mid - 1] as number) + (xs[mid] as number)) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.filter(Number.isFinite).map((v) => Math.abs(v - m)));
}

export function robustZ(x: number, med: number | null, madValue: number | null): number | null {
  if (med === null || madValue === null || !Number.isFinite(x)) return null;
  if (madValue <= 1e-12) return null; // undefined when there is no spread
  return (0.6745 * (x - med)) / madValue;
}

/** Linear-interpolated percentile, p in [0, 100]. */
export function percentile(values: readonly number[], p: number): number | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (p <= 0) return xs[0] as number;
  if (p >= 100) return xs[xs.length - 1] as number;
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return (xs[lo] as number) + ((xs[hi] as number) - (xs[lo] as number)) * (rank - lo);
}

/** EWMA over values in chronological order; returns null for empty input. */
export function ewma(values: readonly number[], alpha: number): number | null {
  if (!(alpha > 0 && alpha <= 1)) throw new RangeError('alpha must be in (0, 1]');
  let s: number | null = null;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    s = s === null ? v : alpha * v + (1 - alpha) * s;
  }
  return s;
}

/**
 * Normal–Normal conjugate update of a mean with known observation variance.
 * Returns the posterior mean and variance.
 */
export function bayesianMeanUpdate(
  prior: { mean: number; variance: number },
  observations: readonly number[],
  observationVariance: number,
): { mean: number; variance: number } {
  if (!(prior.variance > 0) || !(observationVariance > 0)) throw new RangeError('variances must be > 0');
  const xs = observations.filter(Number.isFinite);
  if (xs.length === 0) return { ...prior };
  const precision = 1 / prior.variance + xs.length / observationVariance;
  const mean = (prior.mean / prior.variance + xs.reduce((a, b) => a + b, 0) / observationVariance) / precision;
  return { mean, variance: 1 / precision };
}

export interface MaturityRule {
  developing: { samples: number; days: number };
  established: { samples: number; days: number };
  windowDays: number;
}

export const MATURITY_RULES: Readonly<Partial<Record<MeasurementKind, MaturityRule>>> = Object.freeze({
  resting_heart_rate: { developing: { samples: 5, days: 5 }, established: { samples: 14, days: 14 }, windowDays: 28 },
  hrv_sdnn: { developing: { samples: 10, days: 5 }, established: { samples: 30, days: 14 }, windowDays: 28 },
  heart_rate: { developing: { samples: 30, days: 5 }, established: { samples: 100, days: 14 }, windowDays: 28 },
  respiratory_rate: { developing: { samples: 10, days: 5 }, established: { samples: 30, days: 14 }, windowDays: 28 },
  sleep_asleep: { developing: { samples: 5, days: 5 }, established: { samples: 14, days: 14 }, windowDays: 28 },
  sleeping_wrist_temperature: { developing: { samples: 5, days: 5 }, established: { samples: 14, days: 14 }, windowDays: 28 },
});

const DEFAULT_RULE: MaturityRule = { developing: { samples: 10, days: 5 }, established: { samples: 30, days: 14 }, windowDays: 28 };

export interface BaselineSample {
  value: number;
  at: EpochMs;
  tzOffsetMin: number;
}

export function maturityFor(sampleCount: number, distinctDays: number, rule: MaturityRule): BaselineMaturity {
  if (sampleCount >= rule.established.samples && distinctDays >= rule.established.days) return 'established';
  if (sampleCount >= rule.developing.samples && distinctDays >= rule.developing.days) return 'developing';
  return 'insufficient';
}

export function computeBaseline(params: {
  kind: MeasurementKind;
  context: MeasurementContext;
  unit: string;
  samples: readonly BaselineSample[];
  now: EpochMs;
  /** Exclude samples within these intervals (e.g. drinking sessions) from the baseline. */
  exclude?: readonly { from: EpochMs; to: EpochMs }[];
  rule?: MaturityRule;
  alpha?: number;
}): BaselineSummary {
  const rule = params.rule ?? MATURITY_RULES[params.kind] ?? DEFAULT_RULE;
  const from = params.now - rule.windowDays * DAY_MS;
  const usable = params.samples
    .filter((s) => Number.isFinite(s.value) && s.at >= from && s.at <= params.now)
    .filter((s) => !(params.exclude ?? []).some((x) => s.at >= x.from && s.at <= x.to))
    .sort((a, b) => a.at - b.at);
  const values = usable.map((s) => s.value);
  const days = new Set(usable.map((s) => localDateKey(s.at, s.tzOffsetMin))).size;
  return {
    kind: params.kind,
    context: params.context,
    median: median(values),
    mad: mad(values),
    ewma: values.length ? ewma(values, params.alpha ?? 0.1) : null,
    p10: percentile(values, 10),
    p90: percentile(values, 90),
    sampleCount: values.length,
    distinctDays: days,
    firstSampleAt: usable[0]?.at ?? null,
    lastSampleAt: usable[usable.length - 1]?.at ?? null,
    maturity: maturityFor(values.length, days, rule),
    computedAt: params.now,
    unit: params.unit,
  };
}

/** Samples whose local hour is within ±windowHours of the target hour (circular). */
export function circadianFilter(samples: readonly BaselineSample[], targetHour: number, windowHours = 2): BaselineSample[] {
  return samples.filter((s) => {
    const h = new Date(s.at + s.tzOffsetMin * MINUTE_MS).getUTCHours() + new Date(s.at + s.tzOffsetMin * MINUTE_MS).getUTCMinutes() / 60;
    const d = Math.abs(h - targetHour);
    return Math.min(d, 24 - d) <= windowHours;
  });
}

export type Freshness = 'current' | 'recent' | 'stale';

export function freshnessOf(measuredAt: EpochMs, now: EpochMs): Freshness {
  const age = now - measuredAt;
  if (age <= 20 * MINUTE_MS) return 'current';
  if (age <= 2 * HOUR_MS) return 'recent';
  return 'stale';
}

export interface DeviationAssessment {
  direction: 'elevated' | 'typical' | 'lower' | 'unknown';
  robustZ: number | null;
  freshness: Freshness;
  ageMs: number;
  baselineMaturity: BaselineMaturity;
  reason: 'ok' | 'baseline_insufficient' | 'no_spread' | 'stale';
}

export function assessDeviation(value: number, measuredAt: EpochMs, baseline: BaselineSummary, now: EpochMs, zThreshold = 2): DeviationAssessment {
  const freshness = freshnessOf(measuredAt, now);
  const base = { freshness, ageMs: Math.max(0, now - measuredAt), baselineMaturity: baseline.maturity };
  if (baseline.maturity === 'insufficient') return { ...base, direction: 'unknown', robustZ: null, reason: 'baseline_insufficient' };
  const z = robustZ(value, baseline.median, baseline.mad);
  if (z === null) return { ...base, direction: 'unknown', robustZ: null, reason: 'no_spread' };
  if (freshness === 'stale') return { ...base, direction: 'unknown', robustZ: z, reason: 'stale' };
  const direction = z >= zThreshold ? 'elevated' : z <= -zThreshold ? 'lower' : 'typical';
  return { ...base, direction, robustZ: z, reason: 'ok' };
}

const ALTERNATIVES: Partial<Record<MeasurementKind, string>> = {
  heart_rate: 'Many things affect heart rate, including movement, caffeine, stress, heat, illness and alcohol.',
  resting_heart_rate: 'Resting heart rate varies with sleep, training load, illness, stress and alcohol.',
  hrv_sdnn: 'HRV varies with sleep, stress, training, illness, time of day and alcohol.',
  respiratory_rate: 'Respiratory rate varies with sleep stage, illness and other factors.',
};

const LABELS: Partial<Record<MeasurementKind, string>> = {
  heart_rate: 'heart rate',
  resting_heart_rate: 'resting heart rate',
  hrv_sdnn: 'heart rate variability (HRV)',
  respiratory_rate: 'sleeping respiratory rate',
};

/** Describes a deviation without diagnosing anything, always with freshness and alternatives. */
export function describeDeviation(kind: MeasurementKind, a: DeviationAssessment, measuredAt: EpochMs, now: EpochMs): string {
  const label = LABELS[kind] ?? 'measurement';
  const age = formatAge(measuredAt, now);
  const alt = ALTERNATIVES[kind] ?? 'Many factors can affect this measurement.';
  let text: string;
  switch (a.reason) {
    case 'baseline_insufficient':
      text = `Threshold is still learning your typical ${label}. Your baseline needs more days of data before comparisons are shown.`;
      break;
    case 'no_spread':
      text = `Your recorded ${label} values are too uniform to compare against yet.`;
      break;
    case 'stale':
      text = `Your most recent ${label} reading is from ${age}, which is too old to describe how you are right now.`;
      break;
    default:
      if (a.direction === 'elevated') text = `Your ${label} (${age}) is higher than your usual range. ${alt}`;
      else if (a.direction === 'lower') text = `Your ${label} (${age}) is lower than your usual range. ${alt}`;
      else text = `Your ${label} (${age}) is within your usual range.`;
  }
  return assertSafeMessage(text);
}

// ---------------------------------------------------------------------------
// Sleep aggregation
// ---------------------------------------------------------------------------

export interface NightSummary {
  /** Local date of waking (sleep that ends before 18:00 local belongs to that date). */
  night: LocalDateKey;
  asleepMinutes: number;
  inBedMinutes: number;
  awakeMinutes: number;
  /** Number of awake segments occurring between asleep segments. */
  interruptions: number;
  deepMinutes: number;
  remMinutes: number;
  sleepStart: EpochMs | null;
  sleepEnd: EpochMs | null;
  hasStages: boolean;
}

/**
 * Aggregate HealthKit sleep samples into nights. Overlapping samples from multiple sources are
 * merged per stage (union of intervals) so time is never double counted.
 */
export function summarizeSleep(samples: readonly Pick<Measurement, 'kind' | 'startAt' | 'endAt' | 'sleepStage'>[], tzOffsetMin: number): NightSummary[] {
  const nightOf = (end: number) => localDateKey(end + 6 * HOUR_MS, tzOffsetMin); // ends before 18:00 → same date
  const byNight = new Map<string, typeof samples[number][]>();
  for (const s of samples) {
    if (!['sleep_asleep', 'sleep_in_bed', 'sleep_awake'].includes(s.kind) || s.endAt <= s.startAt) continue;
    const k = nightOf(s.endAt);
    const arr = byNight.get(k) ?? [];
    arr.push(s);
    byNight.set(k, arr);
  }
  const unionMinutes = (iv: { startAt: number; endAt: number }[]) => {
    const sorted = [...iv].sort((a, b) => a.startAt - b.startAt);
    let total = 0;
    let curS = -Infinity;
    let curE = -Infinity;
    for (const x of sorted) {
      if (x.startAt > curE) {
        if (curE > curS) total += curE - curS;
        curS = x.startAt;
        curE = x.endAt;
      } else curE = Math.max(curE, x.endAt);
    }
    if (curE > curS) total += curE - curS;
    return total / MINUTE_MS;
  };
  const out: NightSummary[] = [];
  for (const [night, list] of byNight) {
    const asleep = list.filter((s) => s.kind === 'sleep_asleep');
    const awake = list.filter((s) => s.kind === 'sleep_awake');
    const sleepStart = asleep.length ? Math.min(...asleep.map((s) => s.startAt)) : null;
    const sleepEnd = asleep.length ? Math.max(...asleep.map((s) => s.endAt)) : null;
    const interruptions =
      sleepStart === null || sleepEnd === null ? 0 : awake.filter((w) => w.startAt > sleepStart && w.endAt < sleepEnd).length;
    out.push({
      night,
      asleepMinutes: unionMinutes(asleep),
      inBedMinutes: unionMinutes(list.filter((s) => s.kind === 'sleep_in_bed')),
      awakeMinutes: unionMinutes(awake),
      interruptions,
      deepMinutes: unionMinutes(asleep.filter((s) => s.sleepStage === 'deep')),
      remMinutes: unionMinutes(asleep.filter((s) => s.sleepStage === 'rem')),
      sleepStart,
      sleepEnd,
      hasStages: asleep.some((s) => s.sleepStage && s.sleepStage !== 'unspecified'),
    });
  }
  return out.sort((a, b) => (a.night < b.night ? -1 : 1));
}

export function formatMeasurementValue(kind: MeasurementKind, value: number): string {
  switch (kind) {
    case 'heart_rate':
    case 'resting_heart_rate':
      return `${Math.round(value)} bpm`;
    case 'hrv_sdnn':
      return `${Math.round(value)} ms`;
    case 'respiratory_rate':
      return `${roundTo(value, 1)} br/min`;
    case 'sleep_asleep':
      return `${Math.floor(value / 60)} h ${String(Math.round(value % 60)).padStart(2, '0')} min`;
    default:
      return String(roundTo(value, 1));
  }
}
