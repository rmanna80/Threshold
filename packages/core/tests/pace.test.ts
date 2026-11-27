import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/pace.json';
import { DEFAULT_PACE_THRESHOLDS, PaceTracker, computePace, type PaceEvent } from '../src';
import { MINUTE_MS } from '../src/time';

describe('pace engine — cross-language vectors (independent oracle)', () => {
  it('uses the same thresholds as the vectors', () => {
    expect(DEFAULT_PACE_THRESHOLDS.rapidStandardDrinksIn30Min).toBe(vectors.thresholds.rapid30);
    expect(DEFAULT_PACE_THRESHOLDS.rapidStandardDrinksIn60Min).toBe(vectors.thresholds.rapid60);
    expect(DEFAULT_PACE_THRESHOLDS.rapidDrinkCountIn30Min).toBe(vectors.thresholds.count30);
    expect(DEFAULT_PACE_THRESHOLDS.concentratedStandardDrinksIn120Min).toBe(vectors.thresholds.conc120);
    expect(DEFAULT_PACE_THRESHOLDS.clusterGapMinutes).toBe(vectors.thresholds.gap);
    expect(DEFAULT_PACE_THRESHOLDS.clockSkewToleranceMs).toBe(vectors.thresholds.skew);
  });

  for (const c of vectors.cases) {
    it(`${c.name}: ${c.description}`, () => {
      const tracker = new PaceTracker(c.sessionStartedAt);
      // Feed events one at a time in the given (possibly out-of-order) sequence.
      for (const e of c.events) tracker.upsert(e as PaceEvent);
      const s = tracker.snapshot(c.now);
      const x = c.expected;
      expect(s.totalDrinks).toBe(x.totalDrinks);
      expect(s.totalUnknownStrength).toBe(x.totalUnknownStrength);
      expect(s.totalStandardDrinks).toBeCloseTo(x.totalStandardDrinks, 9);
      for (const w of [15, 30, 60, 120] as const) {
        const ew = x.windows[String(w) as '15'];
        expect(s.windows[w].drinkCount).toBe(ew.drinkCount);
        expect(s.windows[w].standardDrinks).toBeCloseTo(ew.standardDrinks, 9);
        expect(s.windows[w].unknownStrengthCount).toBe(ew.unknownStrengthCount);
      }
      expect(s.timeSinceLastDrinkMs).toBe(x.timeSinceLastDrinkMs);
      if (x.meanIntervalMs === null) expect(s.meanIntervalMs).toBeNull();
      else expect(s.meanIntervalMs).toBeCloseTo(x.meanIntervalMs, 6);
      expect(s.maxDrinksInAny30Min).toBe(x.maxDrinksInAny30Min);
      expect(s.maxStandardDrinksInAny60Min).toBeCloseTo(x.maxStandardDrinksInAny60Min, 9);
      expect(s.clusters).toHaveLength(x.clusterCount);
      expect(s.rapidConsumption).toBe(x.rapidConsumption);
      expect(s.rapidReasons).toEqual(x.rapidReasons);
      expect(s.concentrated).toBe(x.concentrated);
      expect(s.clockSkewDetected).toBe(x.clockSkewDetected);
    });
  }
});

describe('pace engine — properties', () => {
  const start = Date.UTC(2026, 10, 28, 1);
  const e = (id: string, min: number, std: number | null, rev = 1): PaceEvent => ({
    id,
    consumedAt: start + min * MINUTE_MS,
    standardDrinks: std,
    ethanolGrams: std === null ? null : std * 14,
    revision: rev,
    updatedAt: start + min * MINUTE_MS + rev,
    counts: true,
  });

  it('is independent of insertion order', () => {
    const events = [e('a', 5, 1), e('b', 17, 0.5), e('c', 33, 2), e('d', 61, 1), e('f', 64, null)];
    const now = start + 70 * MINUTE_MS;
    const forward = new PaceTracker(start, DEFAULT_PACE_THRESHOLDS, events).snapshot(now);
    const backward = new PaceTracker(start, DEFAULT_PACE_THRESHOLDS, [...events].reverse()).snapshot(now);
    expect(backward).toEqual(forward);
  });

  it('reports whether an upsert changed state (idempotent replays)', () => {
    const t = new PaceTracker(start);
    expect(t.upsert(e('a', 1, 1))).toBe(true);
    expect(t.upsert(e('a', 1, 1))).toBe(false);
    expect(t.upsert(e('a', 1, 2, 2))).toBe(true);
    expect(t.upsert(e('a', 1, 1, 1))).toBe(false);
    expect(t.size).toBe(1);
  });

  it('detects shortening intervals and rising concentration', () => {
    const s = computePace(start, [], start);
    expect(s.intervalTrend).toBe('insufficient_data');
    const t = new PaceTracker(start, DEFAULT_PACE_THRESHOLDS, [e('1', 0, 1), e('2', 60, 1), e('3', 120, 1), e('4', 140, 1), e('5', 155, 1), e('6', 165, 1)]);
    const snap = t.snapshot(start + 168 * MINUTE_MS);
    expect(snap.intervalTrend).toBe('shortening');
    expect(snap.concentrationRising).toBe(true);
    expect(snap.rateChange.last30).toBeGreaterThan(snap.rateChange.previous30);
  });

  it('never exposes a remaining allowance or next-drink time', () => {
    const snap = computePace(start, [], start + MINUTE_MS);
    const keys = Object.keys(snap).join(' ').toLowerCase();
    expect(keys).not.toMatch(/remaining|allow|next|until|safe/);
  });

  it('computes the session rate only after 15 minutes', () => {
    const t = new PaceTracker(start, DEFAULT_PACE_THRESHOLDS, [e('a', 1, 1)]);
    expect(t.snapshot(start + 10 * MINUTE_MS).sessionRatePerHour).toBeNull();
    expect(t.snapshot(start + 30 * MINUTE_MS).sessionRatePerHour).toBeCloseTo(2, 9);
  });

  it('stays fast for large inputs', () => {
    const many = Array.from({ length: 2000 }, (_, i) => e(`x${i}`, i * 0.5, 0.1));
    const t0 = performance.now();
    const tracker = new PaceTracker(start, DEFAULT_PACE_THRESHOLDS, many);
    for (let i = 0; i < 500; i++) tracker.window(60, start + i * MINUTE_MS);
    tracker.snapshot(start + 1000 * MINUTE_MS);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
