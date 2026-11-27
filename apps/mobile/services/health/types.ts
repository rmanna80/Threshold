import type { Measurement, MeasurementKind } from '@threshold/shared-types';

/**
 * Abstraction over health data sources (HealthKit today; external devices later).
 *
 * IMPORTANT platform facts this interface encodes:
 *  - HealthKit never reveals whether *read* access was granted. A denied type simply returns no
 *    samples, so callers must treat "no samples" as `no_data`, never as a measured zero.
 *  - Apple Watch heart rate is sampled intermittently on most models (minutes apart, varying with
 *    activity); newer models record far more frequently. Samples are historical records with
 *    timestamps — the app must display their age and never present them as live readings.
 */
export interface HealthDataProvider {
  readonly id: 'healthkit' | 'unavailable';
  isAvailable(): Promise<boolean>;
  /** Shows the system permission sheet (once per type set). Resolves even if the user declines. */
  requestAuthorization(): Promise<'prompted' | 'unavailable' | 'error'>;
  fetchMeasurements(query: { kinds: MeasurementKind[]; fromMs: number; toMs: number; limitPerKind?: number }): Promise<Measurement[]>;
}

export class UnavailableHealthProvider implements HealthDataProvider {
  readonly id = 'unavailable' as const;
  async isAvailable() {
    return false;
  }
  async requestAuthorization() {
    return 'unavailable' as const;
  }
  async fetchMeasurements() {
    return [];
  }
}
