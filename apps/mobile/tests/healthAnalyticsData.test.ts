import { DAY_MS, HOUR_MS, MINUTE_MS, newId, resolveStandardDrinkDefinition } from '@threshold/core';
import type { Measurement, MeasurementKind } from '@threshold/shared-types';
import { createRepositories } from '../database/repositories';
import { loadAnalytics } from '../services/analyticsService';
import { collectExport, deleteAllLocalData, drinksCsv, USER_DATA_TABLES } from '../services/dataService';
import { fixedClock } from '../services/clock';
import { HealthService } from '../services/health/healthService';
import type { HealthDataProvider } from '../services/health/types';
import { createHarness, T0 } from './support/harness';
import { createTestDatabase } from './support/sqljsDatabase';

const US = resolveStandardDrinkDefinition('US');
const beer = { serving: { value: 12, unit: 'fl_oz_us' as const }, abvPercent: 5, fractionConsumed: 1, definition: US };

function sample(kind: MeasurementKind, value: number, at: number, context: Measurement['context'] = 'resting'): Measurement {
  return { id: newId(), kind, value, unit: kind === 'hrv_sdnn' ? 'ms' : 'count/min', startAt: at, endAt: at, provider: 'healthkit', sourceName: 'Watch', deviceModel: null, quality: 'unknown', samplingHz: null, context, sleepStage: null, externalId: `hk-${kind}-${at}` };
}

class FakeProvider implements HealthDataProvider {
  readonly id = 'healthkit' as const;
  constructor(private readonly data: Measurement[]) {}
  async isAvailable() {
    return true;
  }
  async requestAuthorization() {
    return 'prompted' as const;
  }
  async fetchMeasurements(q: { kinds: MeasurementKind[]; fromMs: number; toMs: number }) {
    return this.data.filter((m) => q.kinds.includes(m.kind) && m.startAt >= q.fromMs && m.startAt <= q.toMs);
  }
}

describe('health service', () => {
  it('ingests idempotently, builds baselines with maturity and never invents readings', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    const now = T0;
    const clock = fixedClock(now, -300);
    const data: Measurement[] = [];
    for (let d = 1; d <= 20; d++) data.push(sample('resting_heart_rate', 58 + (d % 3), now - d * DAY_MS));
    for (let d = 1; d <= 3; d++) data.push(sample('hrv_sdnn', 45 + d, now - d * DAY_MS));
    const svc = new HealthService(repos, new FakeProvider(data), clock, () => true);
    expect((await svc.sync(30)).inserted).toBe(23);
    expect((await svc.sync(30)).inserted).toBe(0); // idempotent on HealthKit sample id
    const rhr = await repos.baselines.get('resting_heart_rate', 'resting');
    expect(rhr?.maturity).toBe('established');
    expect(rhr?.median).toBe(59);
    expect((await repos.baselines.get('hrv_sdnn', 'resting'))?.maturity).toBe('insufficient');
    const ctx = await svc.sessionStartContext();
    expect(ctx.healthDataAuthorized).toBe(true);
    expect(ctx.restingHeartRateBpm?.measuredAt).toBe(now - DAY_MS);
    expect(ctx.lastNightSleepMinutes).toBeNull(); // no sleep data → null, not an estimate
  });

  it('returns nothing when the user has not consented', async () => {
    const db = await createTestDatabase();
    const svc = new HealthService(createRepositories(db), new FakeProvider([sample('resting_heart_rate', 60, T0 - DAY_MS)]), fixedClock(T0), () => false);
    expect((await svc.sync()).inserted).toBe(0);
    expect((await svc.sessionStartContext()).healthDataAuthorized).toBe(false);
    expect(await svc.physiologyForSession()).toBeNull();
  });

  it('describes a fresh sedentary heart-rate reading against a circadian baseline', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    const clock = fixedClock(T0, -300);
    const data: Measurement[] = [];
    for (let d = 1; d <= 20; d++) for (const off of [-30, 0, 30]) data.push(sample('heart_rate', 62 + (d % 4) + off / 30, T0 - d * DAY_MS + off * MINUTE_MS));
    data.push(sample('heart_rate', 96, T0 - 5 * MINUTE_MS));
    const svc = new HealthService(repos, new FakeProvider(data), clock, () => true);
    await svc.sync(30);
    const p = await svc.physiologyForSession();
    expect(p?.heartRate?.direction).toBe('elevated');
    expect(p?.heartRate?.baselineMature).toBe(true);
    clock.advance(HOUR_MS); // reading is now stale
    expect((await svc.physiologyForSession())?.heartRate).toBeNull();
  });
});

describe('analytics service', () => {
  it('computes weekly totals, alcohol-free days and session summaries from storage', async () => {
    const h = await createHarness();
    await h.services.sessions.startSession({ origin: 'phone' });
    for (let i = 0; i < 2; i++) {
      h.clock.advance(30 * MINUTE_MS);
      await h.services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
    }
    const open = await h.services.sessions.getOpenSession();
    await h.services.sessions.end(open!.id);
    const a = await loadAnalytics(h.services, { dayBoundaryHour: 5 }, { alcoholFreeDaysPerWeek: 4, maxStandardDrinksPerWeek: 7 }, 4);
    expect(a.currentWeek.drinkingDays).toBe(1);
    expect(a.currentWeek.standardDrinks).toBeCloseTo(2.000016, 5);
    expect(a.sessions).toHaveLength(1);
    expect(a.sessions[0]?.drinks).toBe(2);
    expect(a.sleepVsPeakPace.status).toBe('insufficient_data');
    expect(a.weeks).toHaveLength(4);
  });
});

describe('data export and deletion', () => {
  it('exports everything and deletion leaves no user rows behind', async () => {
    const h = await createHarness();
    await h.services.repos.settings.recordConsent({ id: newId(), type: 'healthkit', granted: true, version: 'v', recordedAt: 1 });
    await h.services.sessions.startSession({ origin: 'phone' });
    h.clock.advance(MINUTE_MS);
    await h.services.sessions.logDrink({ beverage: { id: null, name: '=cmd|calc', category: 'beer' }, measurement: beer, source: 'manual' });
    const bundle = await collectExport(h.services, '0.1.0');
    expect((bundle.data.drinks as unknown[]).length).toBe(1);
    expect((bundle.data.consents as unknown[]).length).toBe(1);
    const csv = drinksCsv(await h.services.repos.drinks.listAll());
    expect(csv).toContain("'=cmd|calc"); // formula injection neutralised
    await deleteAllLocalData(h.services);
    for (const t of USER_DATA_TABLES) {
      const row = await h.services.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
      expect(row?.n).toBe(0);
    }
  });
});
