import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WITHHELD_MESSAGES, decideRecoveryPrediction, evaluateManifest, mapOffset, type RecoveryModelManifest } from '../src/recoveryModel';
import { buildSessionFeatures } from '../src/sessionFeatures';

const vec = JSON.parse(readFileSync(join(__dirname, '..', 'test-vectors', 'recovery_model.json'), 'utf8')) as {
  manifest: RecoveryModelManifest;
  cases: { values: Record<string, number | null>; expectedProbability: number }[];
  mapOffset: { logits: number[]; outcomes: number[]; sigma: number; expected: number };
};

const evening = buildSessionFeatures({
  session: { startedAt: 1_764_291_600_000, endedAt: 1_764_302_400_000, tzOffsetMin: -300 },
  drinks: [{ consumedAt: 1_764_292_200_000, standardDrinks: 1, isAlcoholic: true, category: 'beer', confirmation: 'user_confirmed', deletedAt: null }],
  priorDrinks: [],
  priorSessionStarts: [],
  sleep: { asleepMinutes: 420, inBedMinutes: 450, interruptions: 1, sleepStart: 1_764_306_000_000 },
});
const validated: RecoveryModelManifest = { ...vec.manifest, status: 'validated' };
const history = (n: number) => Array.from({ length: n }, (_, i) => ({ values: vec.cases[i % vec.cases.length]!.values, severity: i % 2 ? 7 : 1 }));

describe('recovery model evaluation', () => {
  it('reproduces scikit-learn probabilities from the manifest', () => {
    for (const c of vec.cases) expect(evaluateManifest(vec.manifest, c.values)).toBeCloseTo(c.expectedProbability, 10);
  });

  it('reproduces the Python partial-pooling offset', () => {
    expect(mapOffset(vec.mapOffset.logits, vec.mapOffset.outcomes, vec.mapOffset.sigma)).toBeCloseTo(vec.mapOffset.expected, 10);
  });
});

describe('prediction gate', () => {
  it('withholds when the feature flag is off', () => {
    expect(decideRecoveryPrediction({ enabled: false, manifest: validated, features: evening, history: history(10) })).toMatchObject({ status: 'withheld', reason: 'feature_disabled' });
  });

  it('withholds without a validated manifest — including the synthetic test fixture', () => {
    expect(decideRecoveryPrediction({ enabled: true, manifest: null, features: evening, history: history(10) })).toMatchObject({ reason: 'no_validated_model' });
    expect(decideRecoveryPrediction({ enabled: true, manifest: vec.manifest, features: evening, history: history(10) })).toMatchObject({ reason: 'no_validated_model' });
  });

  it('cold start says so instead of guessing', () => {
    const d = decideRecoveryPrediction({ enabled: true, manifest: validated, features: evening, history: history(validated.minHistory - 1) });
    expect(d).toEqual({ status: 'withheld', reason: 'insufficient_personal_data', message: 'Insufficient data for personalized prediction.' });
    expect(WITHHELD_MESSAGES.insufficient_personal_data).toBe('Insufficient data for personalized prediction.');
  });

  it('withholds for low-quality input and for feature-version mismatches', () => {
    const low = buildSessionFeatures({ session: { startedAt: 1, endedAt: 2, tzOffsetMin: 0 }, drinks: [{ consumedAt: 1, standardDrinks: null, isAlcoholic: true, category: 'beer', confirmation: 'user_confirmed', deletedAt: null }] });
    expect(decideRecoveryPrediction({ enabled: true, manifest: validated, features: low, history: history(10) })).toMatchObject({ reason: 'low_input_quality' });
    expect(decideRecoveryPrediction({ enabled: true, manifest: { ...validated, featureVersion: 'sf-v0' }, features: evening, history: history(10) })).toMatchObject({ reason: 'feature_version_mismatch' });
  });

  it('shows a probability with a personalization offset once there is enough history', () => {
    const d = decideRecoveryPrediction({ enabled: true, manifest: validated, features: evening, history: history(10) });
    expect(d.status).toBe('shown');
    if (d.status === 'shown') {
      expect(d.probability).toBeGreaterThan(0);
      expect(d.probability).toBeLessThan(1);
      expect(d.personalized).toBe(true);
      expect(d.interval).toBeNull(); // the fixture has no bootstrap models
      expect(d.message).toMatch(/not a diagnosis/);
    }
  });
});
