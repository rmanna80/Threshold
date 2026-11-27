import {
  isHealthDataAvailableAsync,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
  type CategorySample,
  type QuantitySample,
} from '@kingstinct/react-native-healthkit';
import { newId } from '@threshold/core';
import type { Measurement, MeasurementContext, MeasurementKind } from '@threshold/shared-types';
import type { HealthDataProvider } from './types';

type QuantityId =
  | 'HKQuantityTypeIdentifierHeartRate'
  | 'HKQuantityTypeIdentifierRestingHeartRate'
  | 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
  | 'HKQuantityTypeIdentifierRespiratoryRate'
  | 'HKQuantityTypeIdentifierAppleSleepingWristTemperature'
  | 'HKQuantityTypeIdentifierAppleWalkingSteadiness'
  | 'HKQuantityTypeIdentifierActiveEnergyBurned'
  | 'HKQuantityTypeIdentifierBasalEnergyBurned'
  | 'HKQuantityTypeIdentifierStepCount';

const QUANTITY_MAP: Partial<Record<MeasurementKind, { id: QuantityId; unit: string; context: MeasurementContext }>> = {
  heart_rate: { id: 'HKQuantityTypeIdentifierHeartRate', unit: 'count/min', context: 'unknown' },
  resting_heart_rate: { id: 'HKQuantityTypeIdentifierRestingHeartRate', unit: 'count/min', context: 'resting' },
  // Apple records SDNN when the wearer is still; context is therefore "resting".
  hrv_sdnn: { id: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', unit: 'ms', context: 'resting' },
  respiratory_rate: { id: 'HKQuantityTypeIdentifierRespiratoryRate', unit: 'count/min', context: 'sleep' },
  sleeping_wrist_temperature: { id: 'HKQuantityTypeIdentifierAppleSleepingWristTemperature', unit: 'degC', context: 'sleep' },
  walking_steadiness: { id: 'HKQuantityTypeIdentifierAppleWalkingSteadiness', unit: '%', context: 'active' },
  active_energy: { id: 'HKQuantityTypeIdentifierActiveEnergyBurned', unit: 'kcal', context: 'active' },
  resting_energy: { id: 'HKQuantityTypeIdentifierBasalEnergyBurned', unit: 'kcal', context: 'resting' },
  step_count: { id: 'HKQuantityTypeIdentifierStepCount', unit: 'count', context: 'active' },
};

const SLEEP_KINDS: ReadonlySet<MeasurementKind> = new Set(['sleep_asleep', 'sleep_in_bed', 'sleep_awake']);

/** HKCategoryValueSleepAnalysis raw values. */
const SLEEP_VALUE = { inBed: 0, asleepUnspecified: 1, awake: 2, asleepCore: 3, asleepDeep: 4, asleepREM: 5 } as const;

function deviceModel(s: { device?: { model?: string; hardwareVersion?: string } }): string | null {
  const parts = [s.device?.model, s.device?.hardwareVersion].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function heartRateContext(sample: QuantitySample): MeasurementContext {
  // HKMetadataKeyHeartRateMotionContext: 0 notSet, 1 sedentary, 2 active.
  const raw = (sample.metadata as Record<string, unknown> | undefined)?.HKMetadataKeyHeartRateMotionContext;
  if (raw === 1) return 'resting';
  if (raw === 2) return 'active';
  return 'unknown';
}

function mapQuantity(kind: MeasurementKind, unit: string, ctx: MeasurementContext, s: QuantitySample): Measurement {
  return {
    id: newId(),
    kind,
    value: s.quantity,
    unit,
    startAt: s.startDate.getTime(),
    endAt: s.endDate.getTime(),
    provider: 'healthkit',
    sourceName: s.sourceRevision?.source?.name ?? null,
    deviceModel: deviceModel(s),
    // HealthKit does not expose per-sample signal quality.
    quality: 'unknown',
    samplingHz: null,
    context: kind === 'heart_rate' ? heartRateContext(s) : ctx,
    sleepStage: null,
    externalId: s.uuid,
  };
}

function mapSleep(s: CategorySample): Measurement | null {
  const value = s.value as number;
  let kind: MeasurementKind;
  let stage: Measurement['sleepStage'] = null;
  switch (value) {
    case SLEEP_VALUE.inBed:
      kind = 'sleep_in_bed';
      break;
    case SLEEP_VALUE.awake:
      kind = 'sleep_awake';
      break;
    case SLEEP_VALUE.asleepCore:
      kind = 'sleep_asleep';
      stage = 'core';
      break;
    case SLEEP_VALUE.asleepDeep:
      kind = 'sleep_asleep';
      stage = 'deep';
      break;
    case SLEEP_VALUE.asleepREM:
      kind = 'sleep_asleep';
      stage = 'rem';
      break;
    case SLEEP_VALUE.asleepUnspecified:
      kind = 'sleep_asleep';
      stage = 'unspecified';
      break;
    default:
      return null;
  }
  const start = s.startDate.getTime();
  const end = s.endDate.getTime();
  return {
    id: newId(),
    kind,
    value: Math.max(0, (end - start) / 60_000),
    unit: 'min',
    startAt: start,
    endAt: end,
    provider: 'healthkit',
    sourceName: s.sourceRevision?.source?.name ?? null,
    deviceModel: deviceModel(s),
    quality: 'unknown',
    samplingHz: null,
    context: 'sleep',
    sleepStage: stage,
    externalId: s.uuid,
  };
}

export class HealthKitProvider implements HealthDataProvider {
  readonly id = 'healthkit' as const;

  async isAvailable(): Promise<boolean> {
    try {
      return await isHealthDataAvailableAsync();
    } catch {
      return false;
    }
  }

  async requestAuthorization(): Promise<'prompted' | 'unavailable' | 'error'> {
    if (!(await this.isAvailable())) return 'unavailable';
    try {
      await requestAuthorization({
        toShare: [],
        toRead: [...Object.values(QUANTITY_MAP).map((q) => q!.id), 'HKCategoryTypeIdentifierSleepAnalysis'],
      });
      return 'prompted';
    } catch {
      return 'error';
    }
  }

  async fetchMeasurements({ kinds, fromMs, toMs, limitPerKind = 2000 }: { kinds: MeasurementKind[]; fromMs: number; toMs: number; limitPerKind?: number }) {
    if (!(await this.isAvailable())) return [];
    const filter = { date: { startDate: new Date(fromMs), endDate: new Date(toMs) } };
    const out: Measurement[] = [];
    for (const kind of kinds) {
      const q = QUANTITY_MAP[kind];
      if (q) {
        try {
          const samples = await queryQuantitySamples(q.id, { filter, limit: limitPerKind, ascending: false, unit: q.unit });
          for (const s of samples) out.push(mapQuantity(kind, q.unit, q.context, s));
        } catch {
          // Type unsupported on this OS/hardware or read access unavailable → no data.
        }
      }
    }
    if (kinds.some((k) => SLEEP_KINDS.has(k))) {
      try {
        const samples = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { filter, limit: limitPerKind, ascending: true });
        for (const s of samples) {
          const m = mapSleep(s);
          if (m && kinds.includes(m.kind)) out.push(m);
        }
      } catch {
        // no data
      }
    }
    return out;
  }
}
