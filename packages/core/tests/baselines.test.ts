import { describe, expect, it } from 'vitest';
import {
  assessDeviation,
  bayesianMeanUpdate,
  circadianFilter,
  computeBaseline,
  describeDeviation,
  ewma,
  isSafeMessage,
  mad,
  median,
  percentile,
  robustZ,
  summarizeSleep,
} from '../src';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../src/time';

const NOW = Date.UTC(2026, 10, 28, 2);

describe('robust statistics', () => {
  it('median and MAD', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(mad([])).toBeNull();
  });

  it('robust z = 0.6745 (x − median) / MAD, guarding zero spread', () => {
    expect(robustZ(10, 6, 2)).toBeCloseTo(0.6745 * 2, 12);
    expect(robustZ(10, 6, 0)).toBeNull();
    expect(robustZ(10, null, 1)).toBeNull();
    expect(robustZ(Number.NaN, 6, 1)).toBeNull();
  });

  it('EWMA_t = α x_t + (1 − α) EWMA_{t−1}', () => {
    expect(ewma([10, 20], 0.5)).toBe(15);
    expect(ewma([10, 20, 30], 0.5)).toBe(22.5);
    expect(ewma([], 0.5)).toBeNull();
    expect(() => ewma([1], 0)).toThrow();
  });

  it('percentiles interpolate linearly', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 12);
    expect(percentile([], 50)).toBeNull();
  });

  it('Bayesian mean update shrinks toward the prior with few observations', () => {
    const post = bayesianMeanUpdate({ mean: 60, variance: 25 }, [70], 100);
    expect(post.mean).toBeCloseTo(62, 9);
    expect(post.variance).toBeCloseTo(20, 9);
    expect(bayesianMeanUpdate({ mean: 60, variance: 25 }, [], 100)).toEqual({ mean: 60, variance: 25 });
    expect(() => bayesianMeanUpdate({ mean: 0, variance: 0 }, [1], 1)).toThrow();
  });
});

describe('baselines', () => {
  const daily = (n: number, value = (d: number) => 60 + (d % 3)) =>
    Array.from({ length: n }, (_, i) => ({ value: value(i), at: NOW - (i + 1) * DAY_MS, tzOffsetMin: -300 }));

  it('reports maturity based on samples and distinct days', () => {
    expect(computeBaseline({ kind: 'resting_heart_rate', context: 'resting', unit: 'bpm', samples: daily(3), now: NOW }).maturity).toBe('insufficient');
    expect(computeBaseline({ kind: 'resting_heart_rate', context: 'resting', unit: 'bpm', samples: daily(7), now: NOW }).maturity).toBe('developing');
    const b = computeBaseline({ kind: 'resting_heart_rate', context: 'resting', unit: 'bpm', samples: daily(20), now: NOW });
    expect(b.maturity).toBe('established');
    expect(b.median).toBe(61);
    expect(b.distinctDays).toBe(20);
  });

  it('excludes drinking sessions and samples outside the window', () => {
    const samples = [...daily(10), { value: 120, at: NOW - 2 * HOUR_MS, tzOffsetMin: -300 }, { value: 10, at: NOW - 60 * DAY_MS, tzOffsetMin: -300 }];
    const b = computeBaseline({ kind: 'resting_heart_rate', context: 'resting', unit: 'bpm', samples, now: NOW, exclude: [{ from: NOW - 3 * HOUR_MS, to: NOW }] });
    expect(b.sampleCount).toBe(10);
  });

  it('filters by time of day for circadian comparisons', () => {
    const at = (h: number) => Date.UTC(2026, 10, 20, h + 5); // local hour h in New York
    const s = [22, 23, 1, 12].map((h) => ({ value: 1, at: at(h), tzOffsetMin: -300 }));
    expect(circadianFilter(s, 23, 2)).toHaveLength(3); // wraps midnight
  });
});

describe('deviation assessment', () => {
  const base = computeBaseline({
    kind: 'heart_rate',
    context: 'resting',
    unit: 'bpm',
    samples: Array.from({ length: 120 }, (_, i) => ({ value: 60 + (i % 5), at: NOW - (i + 1) * 4 * HOUR_MS, tzOffsetMin: 0 })),
    now: NOW,
  });

  it('classifies elevated readings only when fresh and the baseline is mature', () => {
    expect(base.maturity).toBe('established');
    expect(assessDeviation(80, NOW - 5 * MINUTE_MS, base, NOW).direction).toBe('elevated');
    expect(assessDeviation(62, NOW - 5 * MINUTE_MS, base, NOW).direction).toBe('typical');
    expect(assessDeviation(80, NOW - 3 * HOUR_MS, base, NOW).reason).toBe('stale');
    const immature = { ...base, maturity: 'insufficient' as const };
    expect(assessDeviation(80, NOW, immature, NOW).reason).toBe('baseline_insufficient');
  });

  it('produces descriptive, non-diagnostic text with freshness and alternatives', () => {
    const a = assessDeviation(80, NOW - 5 * MINUTE_MS, base, NOW);
    const text = describeDeviation('heart_rate', a, NOW - 5 * MINUTE_MS, NOW);
    expect(text).toMatch(/5 min ago/);
    expect(text).toMatch(/caffeine/);
    expect(text).not.toMatch(/intoxicat|drunk|proves/i);
    expect(isSafeMessage(text)).toBe(true);
    for (const reason of ['baseline_insufficient', 'no_spread', 'stale'] as const) {
      expect(isSafeMessage(describeDeviation('hrv_sdnn', { ...a, reason, direction: 'unknown' }, NOW, NOW))).toBe(true);
    }
  });
});

describe('sleep aggregation', () => {
  it('merges overlapping samples, counts interruptions and assigns nights by wake date', () => {
    const night = Date.UTC(2026, 10, 28, 4); // 23:00 New York on the 27th
    const seg = (kind: 'sleep_asleep' | 'sleep_awake' | 'sleep_in_bed', startMin: number, endMin: number, stage: 'core' | 'deep' | 'rem' | null = 'core') => ({
      kind,
      startAt: night + startMin * MINUTE_MS,
      endAt: night + endMin * MINUTE_MS,
      sleepStage: kind === 'sleep_asleep' ? stage : null,
    });
    const nights = summarizeSleep(
      [
        seg('sleep_in_bed', -15, 480),
        seg('sleep_asleep', 0, 120, 'core'),
        seg('sleep_asleep', 100, 200, 'deep'), // overlaps previous by 20 min (two sources)
        seg('sleep_awake', 200, 215),
        seg('sleep_asleep', 215, 460, 'rem'),
      ],
      -300,
    );
    expect(nights).toHaveLength(1);
    expect(nights[0]?.night).toBe('2026-11-28');
    expect(nights[0]?.asleepMinutes).toBe(445);
    expect(nights[0]?.interruptions).toBe(1);
    expect(nights[0]?.hasStages).toBe(true);
  });
});
