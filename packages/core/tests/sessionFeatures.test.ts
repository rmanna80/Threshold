import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BaselineSample } from '../src/baselines';
import { SESSION_FEATURE_NAMES, buildSessionFeatures, nightAfterSession, overnightPhysiology, type SessionFeatureInput } from '../src/sessionFeatures';

interface Vector {
  name: string;
  input: SessionFeatureInput;
  expected: ReturnType<typeof buildSessionFeatures>;
}
const vectors = JSON.parse(readFileSync(join(__dirname, '..', 'test-vectors', 'session_features.json'), 'utf8')) as { cases: Vector[] };
const byName = (n: string) => {
  const c = vectors.cases.find((v) => v.name === n);
  if (!c) throw new Error(n);
  return c;
};

describe('session features sf-v1', () => {
  it('matches every shared vector exactly', () => {
    for (const c of vectors.cases) expect(buildSessionFeatures(c.input)).toEqual(c.expected);
  });

  it('emits every named feature', () => {
    const f = buildSessionFeatures(byName('no_drinks').input);
    expect(Object.keys(f.values).sort()).toEqual([...SESSION_FEATURE_NAMES].sort());
  });

  it('hand-checked values for a typical evening', () => {
    const v = buildSessionFeatures(byName('typical_evening_with_history_sleep_physiology').input).values;
    // Deleted and unconfirmed (motion-detected) drinks are excluded; water is counted separately.
    expect(v.n_drinks).toBe(4);
    expect(v.n_unknown_strength).toBe(1);
    expect(v.std_drinks_known).toBe(3.2);
    expect(v.n_non_alcoholic).toBe(1);
    // Window (t − 30 min, t]: a drink exactly 30 minutes earlier is outside it.
    expect(v.peak_std_30min).toBe(2.2);
    expect(v.peak_std_60min).toBe(3.2);
    expect(v.max_drinks_30min).toBe(2);
    expect(v.drinking_span_min).toBe(80);
    expect(v.last_drink_local_hour).toBe(21.5);
    expect(v.spirits_share).toBe(0.3125); // 1.0 known spirit std / 3.2 known std (unknown cocktail adds 0)
    expect(v.prior_7d_std_drinks).toBe(2.5); // the 8-day-old drink is outside the window
    expect(v.prior_7d_sessions).toBe(1); // a later session is never "prior"
    expect(v.days_since_previous_session).toBe(2);
    expect(v.sleep_efficiency).toBeCloseTo(400 / 450, 6);
    expect(v.sleep_onset_after_last_drink_min).toBe(135);
  });

  it('never imputes: missing groups stay null and lower the input quality', () => {
    const f = buildSessionFeatures(byName('no_drinks').input);
    expect(f.values.prior_7d_std_drinks).toBeNull();
    expect(f.values.sleep_asleep_min).toBeNull();
    expect(f.values.resting_hr_delta_bpm).toBeNull();
    expect(f.inputQuality).toBe('low');
  });

  it('attributes an after-midnight start to the previous night', () => {
    expect(buildSessionFeatures(byName('after_midnight_start_counts_as_friday_night').input).values.weekend_night).toBe(1);
  });

  it('uses only inputs available before the morning check-in', () => {
    // The input type has no check-in fields; this guards against someone adding them as features.
    for (const name of SESSION_FEATURE_NAMES) expect(name).not.toMatch(/headache|nausea|severity|hydration|ate_before|checkin/);
  });
});

interface AssemblyVectors {
  nightAfterSession: { name: string; session: SessionFeatureInput['session']; lastDrinkAt: number | null; nights: { name: string; sleepStart: number | null; sleepEnd: number | null }[]; expectedName: string | null }[];
  overnightPhysiology: { name: string; sessionStartedAt: number; sleep: { sleepStart: number | null; sleepEnd: number | null } | null; restingHr: BaselineSample[]; hrv: BaselineSample[]; expected: { restingHrDeltaBpm: number | null; hrvRobustZ: number | null } }[];
}
const assembly = (vectors as unknown as { assembly: AssemblyVectors }).assembly;

describe('feature input assembly', () => {
  it('selects the sleep that follows the session', () => {
    for (const c of assembly.nightAfterSession) expect(nightAfterSession(c.nights, c.session, c.lastDrinkAt)?.name ?? null).toBe(c.expectedName);
  });

  it('computes overnight physiology against a mature prior baseline only', () => {
    for (const c of assembly.overnightPhysiology) {
      const got = overnightPhysiology({ sessionStartedAt: c.sessionStartedAt, sleep: c.sleep, restingHr: c.restingHr, hrv: c.hrv });
      expect(got).toEqual(c.expected);
    }
  });
});
