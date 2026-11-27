import type { DrinkEvent, EpochMs } from '@threshold/shared-types';
import { countsTowardConsumption } from './drinks';
import { MINUTE_MS } from './time';

/**
 * Real-time consumption pace engine.
 *
 * Deterministic: every output is a pure function of the recorded events and `now`.
 * Efficient: events are kept sorted with prefix sums, so each rolling-window query is two binary
 * searches (O(log n)); inserts/edits/deletes are O(n) (n = drinks in a session, typically < 30).
 * Robust: duplicate deliveries, late (out-of-order) events, edits (higher revision wins) and
 * deletions (tombstones) are all handled; events timestamped in the future beyond a tolerance
 * (clock skew between devices) are excluded from windows and flagged.
 *
 * Nothing here defines a "safe" pace. Thresholds trigger reminders only.
 */

export const PACE_WINDOWS_MIN = [15, 30, 60, 120] as const;
export type PaceWindowMinutes = (typeof PACE_WINDOWS_MIN)[number];

export interface PaceEvent {
  id: string;
  consumedAt: EpochMs;
  /** Null when alcohol content is unknown (still counted as a drink). */
  standardDrinks: number | null;
  ethanolGrams: number | null;
  revision: number;
  updatedAt: EpochMs;
  /** Whether the event counts toward consumption (confirmed/estimated, alcoholic, not deleted). */
  counts: boolean;
}

export function toPaceEvent(d: DrinkEvent): PaceEvent {
  return {
    id: d.id,
    consumedAt: d.consumedAt,
    standardDrinks: d.standardDrinks,
    ethanolGrams: d.ethanolGrams,
    revision: d.revision,
    updatedAt: d.updatedAt,
    counts: countsTowardConsumption(d),
  };
}

export interface PaceThresholds {
  /** ≥ this many standard drinks within 30 minutes is "rapid". */
  rapidStandardDrinksIn30Min: number;
  /** ≥ this many standard drinks within 60 minutes is "rapid". */
  rapidStandardDrinksIn60Min: number;
  /** ≥ this many drinks (any strength, incl. unknown) within 30 minutes is "rapid". */
  rapidDrinkCountIn30Min: number;
  /**
   * ≥ this many standard drinks within 120 minutes is "concentrated". Default 4 mirrors the lower
   * bound of NIAAA's binge-pattern definition (4–5 drinks in about 2 hours); used for wording only.
   */
  concentratedStandardDrinksIn120Min: number;
  /** Consecutive drinks closer than this belong to the same cluster. */
  clusterGapMinutes: number;
  /** Future-dated events beyond this tolerance are treated as clock skew. */
  clockSkewToleranceMs: number;
}

export const DEFAULT_PACE_THRESHOLDS: Readonly<PaceThresholds> = Object.freeze({
  rapidStandardDrinksIn30Min: 2,
  rapidStandardDrinksIn60Min: 3,
  rapidDrinkCountIn30Min: 3,
  concentratedStandardDrinksIn120Min: 4,
  clusterGapMinutes: 20,
  clockSkewToleranceMs: 5 * MINUTE_MS,
});

export interface WindowStats {
  windowMinutes: number;
  drinkCount: number;
  unknownStrengthCount: number;
  standardDrinks: number;
  ethanolGrams: number;
}

export interface DrinkCluster {
  startAt: EpochMs;
  endAt: EpochMs;
  drinkCount: number;
  standardDrinks: number;
}

export type IntervalTrend = 'shortening' | 'stable' | 'lengthening' | 'insufficient_data';

export interface PaceSnapshot {
  computedAt: EpochMs;
  totalDrinks: number;
  totalUnknownStrength: number;
  totalStandardDrinks: number;
  totalEthanolGrams: number;
  windows: Record<PaceWindowMinutes, WindowStats>;
  /** Standard drinks per hour across the session (null until 15 min have elapsed). */
  sessionRatePerHour: number | null;
  lastDrinkAt: EpochMs | null;
  timeSinceLastDrinkMs: number | null;
  meanIntervalMs: number | null;
  recentMeanIntervalMs: number | null;
  intervalTrend: IntervalTrend;
  /** Standard drinks in the last 30 min vs the 30 min before that. */
  rateChange: { last30: number; previous30: number; delta: number };
  maxDrinksInAny30Min: number;
  maxStandardDrinksInAny60Min: number;
  clusters: DrinkCluster[];
  rapidConsumption: boolean;
  rapidReasons: ('std_30' | 'std_60' | 'count_30')[];
  concentrated: boolean;
  concentrationRising: boolean;
  clockSkewDetected: boolean;
}

const EPS = 1e-9;

function upperBound(arr: readonly number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] as number) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class PaceTracker {
  private readonly byId = new Map<string, PaceEvent>();
  private sorted: PaceEvent[] = [];
  private times: number[] = [];
  // prefix sums, length n + 1
  private pStd: number[] = [0];
  private pGrams: number[] = [0];
  private pUnknown: number[] = [0];

  constructor(
    private readonly sessionStartedAt: EpochMs,
    private readonly thresholds: PaceThresholds = DEFAULT_PACE_THRESHOLDS,
    events: Iterable<PaceEvent> = [],
  ) {
    for (const e of events) this.applyWithoutRebuild(e);
    this.rebuild();
  }

  /** Insert or update an event. Returns true if the stored state changed. */
  upsert(event: PaceEvent): boolean {
    const changed = this.applyWithoutRebuild(event);
    if (changed) this.rebuild();
    return changed;
  }

  upsertMany(events: Iterable<PaceEvent>): boolean {
    let changed = false;
    for (const e of events) changed = this.applyWithoutRebuild(e) || changed;
    if (changed) this.rebuild();
    return changed;
  }

  get size(): number {
    return this.sorted.length;
  }

  private applyWithoutRebuild(event: PaceEvent): boolean {
    if (!Number.isFinite(event.consumedAt)) return false;
    const existing = this.byId.get(event.id);
    if (existing) {
      const newer =
        event.revision > existing.revision || (event.revision === existing.revision && event.updatedAt > existing.updatedAt);
      if (!newer) return false;
    }
    this.byId.set(event.id, event);
    return true;
  }

  private rebuild(): void {
    this.sorted = [...this.byId.values()]
      .filter((e) => e.counts)
      .sort((a, b) => a.consumedAt - b.consumedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.times = this.sorted.map((e) => e.consumedAt);
    const n = this.sorted.length;
    this.pStd = new Array<number>(n + 1).fill(0);
    this.pGrams = new Array<number>(n + 1).fill(0);
    this.pUnknown = new Array<number>(n + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const e = this.sorted[i] as PaceEvent;
      this.pStd[i + 1] = (this.pStd[i] as number) + (e.standardDrinks ?? 0);
      this.pGrams[i + 1] = (this.pGrams[i] as number) + (e.ethanolGrams ?? 0);
      this.pUnknown[i + 1] = (this.pUnknown[i] as number) + (e.standardDrinks === null ? 1 : 0);
    }
  }

  /** Stats for events with consumedAt in (from, to]. */
  private range(from: number, to: number, windowMinutes: number): WindowStats {
    const i = upperBound(this.times, from);
    const j = upperBound(this.times, to);
    return {
      windowMinutes,
      drinkCount: Math.max(0, j - i),
      unknownStrengthCount: (this.pUnknown[j] as number) - (this.pUnknown[i] as number),
      standardDrinks: (this.pStd[j] as number) - (this.pStd[i] as number),
      ethanolGrams: (this.pGrams[j] as number) - (this.pGrams[i] as number),
    };
  }

  window(minutes: number, now: EpochMs): WindowStats {
    return this.range(now - minutes * MINUTE_MS, now, minutes);
  }

  snapshot(now: EpochMs): PaceSnapshot {
    const t = this.thresholds;
    const horizon = now + t.clockSkewToleranceMs;
    const visibleEnd = upperBound(this.times, horizon);
    const clockSkewDetected = visibleEnd < this.times.length;
    const visible = this.sorted.slice(0, visibleEnd);
    const visibleTimes = this.times.slice(0, visibleEnd);

    // Window queries use `horizon` as the right edge so slightly skewed events still count.
    const windows = Object.fromEntries(
      PACE_WINDOWS_MIN.map((w) => [w, this.range(now - w * MINUTE_MS, horizon, w)]),
    ) as Record<PaceWindowMinutes, WindowStats>;

    const totalStd = this.pStd[this.sorted.length] as number;
    const totalGrams = this.pGrams[this.sorted.length] as number;
    const totalUnknown = this.pUnknown[this.sorted.length] as number;

    const last = visible[visible.length - 1];
    const intervals: number[] = [];
    for (let i = 1; i < visible.length; i++) {
      intervals.push((visible[i] as PaceEvent).consumedAt - (visible[i - 1] as PaceEvent).consumedAt);
    }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const meanIntervalMs = mean(intervals);
    const recent = intervals.slice(-3);
    const earlier = intervals.slice(0, -3);
    const recentMeanIntervalMs = mean(recent);
    let intervalTrend: IntervalTrend = 'insufficient_data';
    if (recent.length >= 2 && earlier.length >= 1) {
      const e = mean(earlier) as number;
      const r = recentMeanIntervalMs as number;
      if (r < e * 0.75) intervalTrend = 'shortening';
      else if (r > e * 1.25) intervalTrend = 'lengthening';
      else intervalTrend = 'stable';
    }

    const last30 = this.range(now - 30 * MINUTE_MS, horizon, 30).standardDrinks;
    const previous30 = this.range(now - 60 * MINUTE_MS, now - 30 * MINUTE_MS, 30).standardDrinks;

    // Sliding maxima via two pointers over sorted times.
    let maxDrinksInAny30Min = 0;
    let maxStandardDrinksInAny60Min = 0;
    for (let j = 0, i30 = 0, i60 = 0; j < visible.length; j++) {
      const tj = visibleTimes[j] as number;
      while ((visibleTimes[i30] as number) <= tj - 30 * MINUTE_MS) i30++;
      while ((visibleTimes[i60] as number) <= tj - 60 * MINUTE_MS) i60++;
      maxDrinksInAny30Min = Math.max(maxDrinksInAny30Min, j - i30 + 1);
      maxStandardDrinksInAny60Min = Math.max(maxStandardDrinksInAny60Min, (this.pStd[j + 1] as number) - (this.pStd[i60] as number));
    }

    const clusters: DrinkCluster[] = [];
    for (const e of visible) {
      const c = clusters[clusters.length - 1];
      if (c && e.consumedAt - c.endAt <= t.clusterGapMinutes * MINUTE_MS) {
        c.endAt = e.consumedAt;
        c.drinkCount += 1;
        c.standardDrinks += e.standardDrinks ?? 0;
      } else {
        clusters.push({ startAt: e.consumedAt, endAt: e.consumedAt, drinkCount: 1, standardDrinks: e.standardDrinks ?? 0 });
      }
    }

    const rapidReasons: PaceSnapshot['rapidReasons'] = [];
    if (windows[30].standardDrinks + EPS >= t.rapidStandardDrinksIn30Min) rapidReasons.push('std_30');
    if (windows[60].standardDrinks + EPS >= t.rapidStandardDrinksIn60Min) rapidReasons.push('std_60');
    if (windows[30].drinkCount >= t.rapidDrinkCountIn30Min) rapidReasons.push('count_30');

    const elapsed = now - this.sessionStartedAt;
    return {
      computedAt: now,
      totalDrinks: this.sorted.length,
      totalUnknownStrength: totalUnknown,
      totalStandardDrinks: totalStd,
      totalEthanolGrams: totalGrams,
      windows,
      sessionRatePerHour: elapsed >= 15 * MINUTE_MS ? totalStd / (elapsed / (60 * MINUTE_MS)) : null,
      lastDrinkAt: last?.consumedAt ?? null,
      timeSinceLastDrinkMs: last ? Math.max(0, now - last.consumedAt) : null,
      meanIntervalMs,
      recentMeanIntervalMs,
      intervalTrend,
      rateChange: { last30, previous30, delta: last30 - previous30 },
      maxDrinksInAny30Min,
      maxStandardDrinksInAny60Min,
      clusters,
      rapidConsumption: rapidReasons.length > 0,
      rapidReasons,
      concentrated: windows[120].standardDrinks + EPS >= t.concentratedStandardDrinksIn120Min,
      concentrationRising: intervalTrend === 'shortening' || (last30 > previous30 + EPS && last30 >= 1),
      clockSkewDetected,
    };
  }
}

/** Convenience: snapshot directly from drink events. */
export function computePace(
  sessionStartedAt: EpochMs,
  drinks: readonly DrinkEvent[],
  now: EpochMs,
  thresholds: PaceThresholds = DEFAULT_PACE_THRESHOLDS,
): PaceSnapshot {
  return new PaceTracker(sessionStartedAt, thresholds, drinks.map(toPaceEvent)).snapshot(now);
}

