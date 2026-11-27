import type { DrinkEvent, DrinkingSession, LocalDateKey, RecoveryCheckin, UserGoals } from '@threshold/shared-types';
import { countsTowardConsumption } from './drinks';
import { computePace } from './pace';
import { activeDurationMs, sessionDurationMs } from './session';
import { MINUTE_MS, addDays, enumerateDays, localDateKey, startOfMonth, startOfWeek } from './time';

/**
 * Historical analytics. All figures are computed from user-recorded data; every output states
 * how many observations it rests on. Nothing here frames higher consumption or tolerance as an
 * achievement — alcohol-free days and goal adherence are the celebrated metrics.
 */

export interface DailyTotal {
  date: LocalDateKey;
  standardDrinks: number;
  drinks: number;
  unknownStrength: number;
}

export function dailyTotals(drinks: readonly DrinkEvent[], dayBoundaryHour: number): Map<LocalDateKey, DailyTotal> {
  const map = new Map<LocalDateKey, DailyTotal>();
  for (const d of drinks) {
    if (!countsTowardConsumption(d)) continue;
    const key = localDateKey(d.consumedAt, d.tzOffsetMin, dayBoundaryHour);
    const cur = map.get(key) ?? { date: key, standardDrinks: 0, drinks: 0, unknownStrength: 0 };
    cur.standardDrinks += d.standardDrinks ?? 0;
    cur.drinks += 1;
    if (d.standardDrinks === null) cur.unknownStrength += 1;
    map.set(key, cur);
  }
  return map;
}

export interface PeriodSummary {
  from: LocalDateKey;
  to: LocalDateKey;
  /** Days in the period up to and including `today` (future days are not counted). */
  elapsedDays: number;
  standardDrinks: number;
  drinks: number;
  unknownStrength: number;
  drinkingDays: number;
  alcoholFreeDays: number;
}

export function summarizePeriod(totals: Map<LocalDateKey, DailyTotal>, from: LocalDateKey, to: LocalDateKey, today: LocalDateKey): PeriodSummary {
  const end = to < today ? to : today;
  const days = enumerateDays(from, end);
  let std = 0;
  let drinks = 0;
  let unknown = 0;
  let drinkingDays = 0;
  for (const day of days) {
    const t = totals.get(day);
    if (t && t.drinks > 0) {
      drinkingDays += 1;
      std += t.standardDrinks;
      drinks += t.drinks;
      unknown += t.unknownStrength;
    }
  }
  return { from, to, elapsedDays: days.length, standardDrinks: std, drinks, unknownStrength: unknown, drinkingDays, alcoholFreeDays: days.length - drinkingDays };
}

export function weeklySeries(totals: Map<LocalDateKey, DailyTotal>, today: LocalDateKey, weeks: number): PeriodSummary[] {
  const current = startOfWeek(today);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(current, -7 * (weeks - 1 - i));
    return summarizePeriod(totals, from, addDays(from, 6), today);
  });
}

export function monthlySeries(totals: Map<LocalDateKey, DailyTotal>, today: LocalDateKey, months: number): PeriodSummary[] {
  const out: PeriodSummary[] = [];
  let start = startOfMonth(today);
  const starts: LocalDateKey[] = [];
  for (let i = 0; i < months; i++) {
    starts.unshift(start);
    start = startOfMonth(addDays(start, -1));
  }
  for (const s of starts) {
    const nextMonth = startOfMonth(addDays(s, 32));
    out.push(summarizePeriod(totals, s, addDays(nextMonth, -1), today));
  }
  return out;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  localDate: LocalDateKey;
  durationMs: number;
  activeDurationMs: number;
  drinks: number;
  standardDrinks: number;
  unknownStrength: number;
  peakStandardDrinksIn60Min: number;
  maxDrinksIn30Min: number;
  meanIntervalMin: number | null;
  /** Time of the last counted alcoholic drink, or null. */
  lastDrinkAt: number | null;
  goal: number | null;
  goalMet: boolean | null;
}

export function summarizeSession(session: DrinkingSession, drinks: readonly DrinkEvent[], now: number, dayBoundaryHour: number): SessionSummary {
  const own = drinks.filter((d) => d.sessionId === session.id);
  const end = session.endedAt ?? now;
  const pace = computePace(session.startedAt, own, end);
  const goal = session.goalSnapshot.maxStandardDrinksPerSession;
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    localDate: localDateKey(session.startedAt, session.tzOffsetMin, dayBoundaryHour),
    durationMs: sessionDurationMs(session, now),
    activeDurationMs: activeDurationMs(session, now),
    drinks: pace.totalDrinks,
    standardDrinks: pace.totalStandardDrinks,
    unknownStrength: pace.totalUnknownStrength,
    peakStandardDrinksIn60Min: pace.maxStandardDrinksInAny60Min,
    maxDrinksIn30Min: pace.maxDrinksInAny30Min,
    meanIntervalMin: pace.meanIntervalMs === null ? null : pace.meanIntervalMs / MINUTE_MS,
    lastDrinkAt: own.filter(countsTowardConsumption).reduce<number | null>((m, d) => (m === null || d.consumedAt > m ? d.consumedAt : m), null),
    goal,
    goalMet: goal === null ? null : pace.totalStandardDrinks <= goal + 1e-9,
  };
}

export interface HistogramBin {
  label: string;
  min: number;
  max: number | null;
  count: number;
}

function histogram(values: readonly number[], edges: readonly number[], unit: string): HistogramBin[] {
  const bins: HistogramBin[] = edges.map((min, i) => {
    const max = edges[i + 1] ?? null;
    return { label: max === null ? `${min}+ ${unit}` : `${min}–${max} ${unit}`, min, max, count: 0 };
  });
  for (const v of values) {
    const bin = bins.find((b) => v >= b.min && (b.max === null || v < b.max));
    if (bin) bin.count += 1;
  }
  return bins;
}

/** Distribution of minutes between consecutive drinks across sessions. */
export function intervalDistribution(sessions: readonly DrinkingSession[], drinks: readonly DrinkEvent[]): HistogramBin[] {
  const values: number[] = [];
  for (const s of sessions) {
    const times = drinks
      .filter((d) => d.sessionId === s.id && countsTowardConsumption(d))
      .map((d) => d.consumedAt)
      .sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) values.push(((times[i] as number) - (times[i - 1] as number)) / MINUTE_MS);
  }
  return histogram(values, [0, 10, 20, 30, 45, 60, 90], 'min');
}

/** Distribution of each session's peak 60-minute standard-drink total. */
export function paceDistribution(summaries: readonly SessionSummary[]): HistogramBin[] {
  return histogram(
    summaries.filter((s) => s.drinks > 0).map((s) => s.peakStandardDrinksIn60Min),
    [0, 1, 2, 3, 4],
    'per hour',
  );
}

export interface HeatmapCell {
  date: LocalDateKey;
  standardDrinks: number;
  /** 0 = alcohol-free; 1–4 = fixed buckets (<1, 1–<2, 2–<4, ≥4). Not relative to the user. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

export function calendarHeatmap(totals: Map<LocalDateKey, DailyTotal>, from: LocalDateKey, to: LocalDateKey, today: LocalDateKey): HeatmapCell[] {
  return enumerateDays(from, to).map((date) => {
    const t = totals.get(date);
    const std = t?.standardDrinks ?? 0;
    const drank = (t?.drinks ?? 0) > 0;
    const level: HeatmapCell['level'] = !drank ? 0 : std < 1 ? 1 : std < 2 ? 2 : std < 4 ? 3 : 4;
    return { date, standardDrinks: std, level, future: date > today };
  });
}

export interface GoalAdherenceWeek {
  weekStart: LocalDateKey;
  alcoholFreeDays: number;
  alcoholFreeGoal: number | null;
  alcoholFreeGoalMet: boolean | null;
  standardDrinks: number;
  weeklyGoal: number | null;
  weeklyGoalMet: boolean | null;
  complete: boolean;
}

export function goalAdherence(weeks: readonly PeriodSummary[], goals: Pick<UserGoals, 'alcoholFreeDaysPerWeek' | 'maxStandardDrinksPerWeek'>): GoalAdherenceWeek[] {
  return weeks.map((w) => {
    const complete = w.elapsedDays === 7;
    const af = goals.alcoholFreeDaysPerWeek;
    const wk = goals.maxStandardDrinksPerWeek;
    return {
      weekStart: w.from,
      alcoholFreeDays: w.alcoholFreeDays,
      alcoholFreeGoal: af,
      // An incomplete week is "met" early once the AF goal is reached; otherwise undecided.
      alcoholFreeGoalMet: af === null ? null : w.alcoholFreeDays >= af ? true : complete ? false : null,
      standardDrinks: w.standardDrinks,
      weeklyGoal: wk,
      weeklyGoalMet: wk === null ? null : w.standardDrinks > wk + 1e-9 ? false : complete ? true : null,
      complete,
    };
  });
}

// ---------------------------------------------------------------------------
// Descriptive associations (correlation ≠ causation)
// ---------------------------------------------------------------------------

export interface AssociationResult {
  status: 'insufficient_data' | 'computed';
  n: number;
  /** Mean outcome in sessions at or below vs above the median of the exposure. */
  lowerGroup: { n: number; meanOutcome: number } | null;
  higherGroup: { n: number; meanOutcome: number } | null;
  spearmanRho: number | null;
  minimumPerGroup: number;
}

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && (idx[j + 1] as { v: number }).v === (idx[k] as { v: number }).v) j++;
    const avg = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) r[(idx[m] as { i: number }).i] = avg;
    k = j + 1;
  }
  return r;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    const a = (rx[i] as number) - mx;
    const b = (ry[i] as number) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function associate(pairs: readonly { exposure: number; outcome: number }[], minimumPerGroup = 5): AssociationResult {
  const n = pairs.length;
  const base: AssociationResult = { status: 'insufficient_data', n, lowerGroup: null, higherGroup: null, spearmanRho: null, minimumPerGroup };
  if (n < minimumPerGroup * 2) return base;
  const sorted = [...pairs].sort((a, b) => a.exposure - b.exposure);
  const median = (sorted[Math.floor((n - 1) / 2)] as { exposure: number }).exposure;
  const lower = pairs.filter((p) => p.exposure <= median);
  const higher = pairs.filter((p) => p.exposure > median);
  if (lower.length < minimumPerGroup || higher.length < minimumPerGroup) return base;
  const mean = (g: typeof pairs) => g.reduce((s, p) => s + p.outcome, 0) / g.length;
  return {
    status: 'computed',
    n,
    lowerGroup: { n: lower.length, meanOutcome: mean(lower) },
    higherGroup: { n: higher.length, meanOutcome: mean(higher) },
    spearmanRho: spearman(pairs.map((p) => p.exposure), pairs.map((p) => p.outcome)),
    minimumPerGroup,
  };
}

/** Pair each session with the check-in that refers to it. */
export function pairSessionsWithCheckins(
  summaries: readonly SessionSummary[],
  checkins: readonly RecoveryCheckin[],
  exposure: (s: SessionSummary) => number,
  outcome: (c: RecoveryCheckin) => number | null,
): { exposure: number; outcome: number }[] {
  const bySession = new Map(checkins.filter((c) => c.sessionId && c.deletedAt === null).map((c) => [c.sessionId as string, c]));
  const out: { exposure: number; outcome: number }[] = [];
  for (const s of summaries) {
    const c = bySession.get(s.sessionId);
    if (!c) continue;
    const y = outcome(c);
    if (y === null) continue;
    out.push({ exposure: exposure(s), outcome: y });
  }
  return out;
}
