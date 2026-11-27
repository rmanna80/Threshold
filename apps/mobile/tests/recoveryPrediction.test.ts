import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUR_MS, MINUTE_MS, newId, resolveStandardDrinkDefinition, type RecoveryModelManifest } from '@threshold/core';
import type { Measurement, RecoveryCheckin } from '@threshold/shared-types';
import { RecoveryPredictionService } from '../services/recovery/recoveryPredictionService';
import { deleteAllLocalData } from '../services/dataService';
import { createHarness, type Harness } from './support/harness';

const US = resolveStandardDrinkDefinition('US');
const beer = { serving: { value: 12, unit: 'fl_oz_us' as const }, abvPercent: 5, fractionConsumed: 1, definition: US };
const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'core', 'test-vectors', 'recovery_model.json'), 'utf8')) as { manifest: RecoveryModelManifest };
const validatedFixture: RecoveryModelManifest = { ...fixture.manifest, status: 'validated' };

async function evening(h: Harness, drinks: number): Promise<string> {
  const s = await h.services.sessions.startSession({ origin: 'phone' });
  if (!s.ok) throw new Error('start failed');
  for (let i = 0; i < drinks; i++) {
    h.clock.advance(25 * MINUTE_MS);
    await h.services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
  }
  h.clock.advance(30 * MINUTE_MS);
  await h.services.sessions.end(s.value.id);
  return s.value.id;
}

function checkin(sessionId: string, severity: number, at: number): RecoveryCheckin {
  return {
    id: newId(),
    sessionId,
    localDate: '2026-11-28',
    completedAt: at,
    headache: null,
    fatigue: null,
    nausea: null,
    dizziness: null,
    sleepQuality: null,
    mentalClarity: null,
    overallSeverity: severity,
    functionalImpairment: null,
    ateBeforeDrinking: null,
    hydrationReported: null,
    revision: 1,
    updatedAt: at,
    deletedAt: null,
  };
}

const sleep = (kind: Measurement['kind'], from: number, to: number): Measurement => ({
  id: newId(),
  kind,
  value: (to - from) / MINUTE_MS,
  unit: 'min',
  startAt: from,
  endAt: to,
  provider: 'healthkit',
  sourceName: 'Watch',
  deviceModel: null,
  quality: 'unknown',
  samplingHz: null,
  context: 'sleep',
  sleepStage: null,
  externalId: `hk-${kind}-${from}`,
});

describe('recovery prediction service', () => {
  it('stores sf-v1 features when a session ends', async () => {
    const h = await createHarness();
    const id = await evening(h, 3);
    await new Promise((r) => setTimeout(r, 0));
    const f = await h.services.repos.sessionFeatures.get(id);
    expect(f?.version).toBe('sf-v1');
    expect(f?.values.n_drinks).toBe(3);
    expect(f?.values.sleep_asleep_min).toBeNull(); // no Health data → missing, not estimated
  });

  it('withholds and logs the reason while the feature flag is off (this build)', async () => {
    const h = await createHarness();
    const id = await evening(h, 2);
    const out = await h.services.recovery.outlookFor(id);
    expect(out?.decision).toMatchObject({ status: 'withheld', reason: 'feature_disabled' });
    await h.services.recovery.outlookFor(id);
    const logged = await h.services.repos.predictions.listForSession(id);
    expect(logged).toHaveLength(1); // one audit row per session × model version
    expect(logged[0]).toMatchObject({ status: 'withheld', withheldReason: 'feature_disabled', probability: null, modelId: 'recovery_risk:none' });
  });

  it('withholds without a validated model even when the flag is on', async () => {
    const h = await createHarness();
    const id = await evening(h, 2);
    const svc = new RecoveryPredictionService(h.services.repos, h.clock, { enabled: true, manifest: fixture.manifest });
    expect((await svc.outlookFor(id))?.decision).toMatchObject({ reason: 'no_validated_model' });
  });

  it('cold start: "Insufficient data for personalized prediction" until enough check-ins exist', async () => {
    const h = await createHarness();
    const svc = new RecoveryPredictionService(h.services.repos, h.clock, { enabled: true, manifest: validatedFixture });
    const ids: string[] = [];
    for (let i = 0; i < validatedFixture.minHistory; i++) {
      const id = await evening(h, 1 + (i % 3));
      ids.push(id);
      h.clock.advance(10 * HOUR_MS);
      await h.services.repos.checkins.upsert(checkin(id, i % 2 ? 6 : 2, h.clock.now()));
      h.clock.advance(2 * 24 * HOUR_MS);
    }
    const tonight = await evening(h, 3);
    // Sleep after tonight so the input quality is not "low".
    const end = h.clock.now();
    await h.services.repos.measurements.insertMany([sleep('sleep_asleep', end + HOUR_MS, end + 8 * HOUR_MS), sleep('sleep_in_bed', end + 50 * MINUTE_MS, end + 8.5 * HOUR_MS)]);

    const few = new RecoveryPredictionService(h.services.repos, h.clock, { enabled: true, manifest: { ...validatedFixture, minHistory: validatedFixture.minHistory + 1 } });
    expect((await few.outlookFor(tonight))?.decision).toEqual({ status: 'withheld', reason: 'insufficient_personal_data', message: 'Insufficient data for personalized prediction.' });

    const out = await svc.outlookFor(tonight);
    expect(out?.features.values.sleep_asleep_min).toBe(420);
    expect(out?.decision.status).toBe('shown');
    const logged = await h.services.repos.predictions.listForSession(tonight);
    expect(logged.at(-1)?.probability).toBeGreaterThan(0);
  });

  it('deleting all local data removes features and prediction logs', async () => {
    const h = await createHarness();
    const id = await evening(h, 1);
    await h.services.recovery.outlookFor(id);
    await deleteAllLocalData(h.services);
    expect(await h.services.repos.sessionFeatures.listAll()).toHaveLength(0);
    expect(await h.services.repos.predictions.listAll()).toHaveLength(0);
  });
});
