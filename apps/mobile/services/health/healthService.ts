import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  assessDeviation,
  circadianFilter,
  computeBaseline,
  summarizeSleep,
  type BaselineSample,
  type NightSummary,
  type PhysiologyContext,
} from '@threshold/core';
import type { BaselineSummary, MeasurementKind, MeasurementSnapshot, SessionStartContext } from '@threshold/shared-types';
import type { Repositories } from '../../database/repositories';
import type { Clock } from '../clock';
import type { HealthDataProvider } from './types';

const DAILY_KINDS: MeasurementKind[] = ['resting_heart_rate', 'hrv_sdnn', 'respiratory_rate', 'sleeping_wrist_temperature', 'sleep_asleep', 'sleep_in_bed', 'sleep_awake'];

/**
 * Bridges a HealthDataProvider into local storage, baselines and session context. Every value it
 * exposes is a real, timestamped sample; when nothing is available it returns null rather than
 * an estimate.
 */
export class HealthService {
  constructor(
    private readonly repos: Repositories,
    private readonly provider: HealthDataProvider,
    private readonly clock: Clock,
    private readonly isAllowed: () => boolean,
  ) {}

  get providerId() {
    return this.provider.id;
  }

  async isAvailable(): Promise<boolean> {
    return this.isAllowed() && (await this.provider.isAvailable());
  }

  /** Pull recent samples into the local store and recompute baselines. Idempotent. */
  async sync(days = 30): Promise<{ inserted: number }> {
    if (!(await this.isAvailable())) return { inserted: 0 };
    const now = this.clock.now();
    const daily = await this.provider.fetchMeasurements({ kinds: DAILY_KINDS, fromMs: now - days * DAY_MS, toMs: now, limitPerKind: 4000 });
    // Heart rate can be very dense on newer watches; keep a bounded recent window.
    const hr = await this.provider.fetchMeasurements({ kinds: ['heart_rate'], fromMs: now - 14 * DAY_MS, toMs: now, limitPerKind: 5000 });
    const inserted = await this.repos.measurements.insertMany([...daily, ...hr]);
    await this.recomputeBaselines();
    return { inserted };
  }

  /** Refresh only the most recent heart-rate samples (used during a session). */
  async refreshRecentHeartRate(): Promise<void> {
    if (!(await this.isAvailable())) return;
    const now = this.clock.now();
    const hr = await this.provider.fetchMeasurements({ kinds: ['heart_rate'], fromMs: now - 2 * HOUR_MS, toMs: now, limitPerKind: 500 });
    await this.repos.measurements.insertMany(hr);
  }

  private toSamples(list: { value: number; startAt: number }[]): BaselineSample[] {
    return list.map((m) => ({ value: m.value, at: m.startAt, tzOffsetMin: this.clock.tzOffsetMin(m.startAt) }));
  }

  async recomputeBaselines(): Promise<BaselineSummary[]> {
    const now = this.clock.now();
    const from = now - 30 * DAY_MS;
    const sessions = await this.repos.sessions.listBetween(from - DAY_MS, now);
    // Physiology during drinking sessions (and the following 12 h) is excluded from baselines.
    const exclude = sessions.map((s) => ({ from: s.startedAt, to: (s.endedAt ?? now) + 12 * HOUR_MS }));
    const out: BaselineSummary[] = [];
    const save = async (b: BaselineSummary) => {
      await this.repos.baselines.save(b);
      out.push(b);
    };
    for (const [kind, context, unit] of [
      ['resting_heart_rate', 'resting', 'count/min'],
      ['hrv_sdnn', 'resting', 'ms'],
      ['respiratory_rate', 'sleep', 'count/min'],
      ['sleeping_wrist_temperature', 'sleep', 'degC'],
    ] as const) {
      const list = await this.repos.measurements.list([kind], from, now);
      await save(computeBaseline({ kind, context, unit, samples: this.toSamples(list), now, exclude }));
    }
    const sedentary = await this.repos.measurements.list(['heart_rate'], from, now, 'resting');
    await save(computeBaseline({ kind: 'heart_rate', context: 'resting', unit: 'count/min', samples: this.toSamples(sedentary), now, exclude }));
    const nights = await this.sleepNights(from, now);
    await save(
      computeBaseline({
        kind: 'sleep_asleep',
        context: 'sleep',
        unit: 'min',
        samples: nights.filter((n) => n.sleepEnd !== null && n.asleepMinutes > 0).map((n) => ({ value: n.asleepMinutes, at: n.sleepEnd as number, tzOffsetMin: this.clock.tzOffsetMin(n.sleepEnd as number) })),
        now,
        exclude: [],
      }),
    );
    return out;
  }

  async sleepNights(fromMs: number, toMs: number): Promise<NightSummary[]> {
    const samples = await this.repos.measurements.list(['sleep_asleep', 'sleep_in_bed', 'sleep_awake'], fromMs, toMs);
    return summarizeSleep(samples, this.clock.tzOffsetMin(toMs));
  }

  private snapshot(m: { value: number; unit: string; endAt: number; sourceName: string | null } | null, maxAgeMs: number): MeasurementSnapshot | null {
    if (!m || this.clock.now() - m.endAt > maxAgeMs) return null;
    return { value: m.value, unit: m.unit, measuredAt: m.endAt, source: m.sourceName ?? 'Apple Health' };
  }

  /** Context captured at session start — only real readings within sensible freshness windows. */
  async sessionStartContext(): Promise<SessionStartContext> {
    const allowed = await this.isAvailable();
    if (!allowed) return { restingHeartRateBpm: null, hrvSdnnMs: null, lastNightSleepMinutes: null, healthDataAuthorized: false };
    await this.sync(3).catch(() => undefined);
    const now = this.clock.now();
    const nights = await this.sleepNights(now - 2 * DAY_MS, now);
    const lastNight = nights[nights.length - 1];
    return {
      restingHeartRateBpm: this.snapshot(await this.repos.measurements.latest('resting_heart_rate'), 36 * HOUR_MS),
      hrvSdnnMs: this.snapshot(await this.repos.measurements.latest('hrv_sdnn'), 36 * HOUR_MS),
      lastNightSleepMinutes:
        lastNight && lastNight.sleepEnd !== null && now - lastNight.sleepEnd < 24 * HOUR_MS
          ? { value: lastNight.asleepMinutes, unit: 'min', measuredAt: lastNight.sleepEnd, source: 'Apple Health' }
          : null,
      healthDataAuthorized: true,
    };
  }

  /**
   * Physiology context for interventions: the latest *sedentary* heart-rate sample from the last
   * 30 minutes compared with the user's sedentary heart rate at a similar time of day.
   */
  async physiologyForSession(): Promise<PhysiologyContext | null> {
    if (!(await this.isAvailable())) return null;
    await this.refreshRecentHeartRate().catch(() => undefined);
    const now = this.clock.now();
    const latest = await this.repos.measurements.latest('heart_rate', 'resting');
    if (!latest || now - latest.endAt > 30 * MINUTE_MS) return { heartRate: null };
    const tz = this.clock.tzOffsetMin(latest.startAt);
    const hour = new Date(latest.startAt + tz * MINUTE_MS).getUTCHours();
    const history = await this.repos.measurements.list(['heart_rate'], now - 30 * DAY_MS, now - 12 * HOUR_MS, 'resting');
    const sessions = await this.repos.sessions.listBetween(now - 31 * DAY_MS, now);
    const baseline = computeBaseline({
      kind: 'heart_rate',
      context: 'resting',
      unit: 'count/min',
      samples: circadianFilter(this.toSamples(history), hour, 2),
      now,
      exclude: sessions.map((s) => ({ from: s.startedAt, to: (s.endedAt ?? now) + 12 * HOUR_MS })),
    });
    const a = assessDeviation(latest.value, latest.endAt, baseline, now);
    if (a.direction === 'unknown') return { heartRate: null };
    return {
      heartRate: {
        direction: a.direction,
        measuredAt: latest.endAt,
        baselineMature: baseline.maturity !== 'insufficient',
        measurementId: latest.externalId ?? latest.id,
      },
    };
  }
}
