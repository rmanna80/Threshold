import type { BaselineSummary, Measurement, MeasurementContext, MeasurementKind } from '@threshold/shared-types';
import { parseJson, type SqlDatabase } from '../types';

interface MeasurementRow {
  id: string;
  kind: MeasurementKind;
  value: number;
  unit: string;
  start_at: number;
  end_at: number;
  provider: Measurement['provider'];
  source_name: string | null;
  device_model: string | null;
  quality: Measurement['quality'];
  sampling_hz: number | null;
  context: MeasurementContext;
  sleep_stage: Measurement['sleepStage'];
  external_id: string | null;
}

const toMeasurement = (r: MeasurementRow): Measurement => ({
  id: r.id,
  kind: r.kind,
  value: r.value,
  unit: r.unit,
  startAt: r.start_at,
  endAt: r.end_at,
  provider: r.provider,
  sourceName: r.source_name,
  deviceModel: r.device_model,
  quality: r.quality,
  samplingHz: r.sampling_hz,
  context: r.context,
  sleepStage: r.sleep_stage,
  externalId: r.external_id,
});

/** Local copies of health samples. Ingestion is idempotent on the source sample id. */
export class MeasurementRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insertMany(items: readonly Measurement[]): Promise<number> {
    let inserted = 0;
    for (const m of items) {
      if (!Number.isFinite(m.value)) continue;
      const r = await this.db.runAsync(
        `INSERT OR IGNORE INTO measurements (id, kind, value, unit, start_at, end_at, provider, source_name, device_model, quality,
           sampling_hz, context, sleep_stage, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.id, m.kind, m.value, m.unit, m.startAt, m.endAt, m.provider, m.sourceName, m.deviceModel, m.quality, m.samplingHz, m.context, m.sleepStage ?? null, m.externalId],
      );
      inserted += r.changes;
    }
    return inserted;
  }

  async list(kinds: readonly MeasurementKind[], fromMs: number, toMs: number, context?: MeasurementContext): Promise<Measurement[]> {
    if (kinds.length === 0) return [];
    const placeholders = kinds.map(() => '?').join(', ');
    const rows = await this.db.getAllAsync<MeasurementRow>(
      `SELECT * FROM measurements WHERE kind IN (${placeholders}) AND start_at >= ? AND start_at <= ? ${context ? 'AND context = ?' : ''}
       ORDER BY start_at ASC`,
      [...kinds, fromMs, toMs, ...(context ? [context] : [])],
    );
    return rows.map(toMeasurement);
  }

  async latest(kind: MeasurementKind, context?: MeasurementContext): Promise<Measurement | null> {
    const row = await this.db.getFirstAsync<MeasurementRow>(
      `SELECT * FROM measurements WHERE kind = ? ${context ? 'AND context = ?' : ''} ORDER BY end_at DESC LIMIT 1`,
      context ? [kind, context] : [kind],
    );
    return row ? toMeasurement(row) : null;
  }

  async count(): Promise<number> {
    const r = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM measurements');
    return r?.n ?? 0;
  }

  async deleteAll(): Promise<void> {
    await this.db.runAsync('DELETE FROM measurements');
    await this.db.runAsync('DELETE FROM physiological_baselines');
  }
}

export class BaselineRepository {
  constructor(private readonly db: SqlDatabase) {}

  async save(b: BaselineSummary): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO physiological_baselines (kind, context, json, computed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, context) DO UPDATE SET json = excluded.json, computed_at = excluded.computed_at`,
      [b.kind, b.context, JSON.stringify(b), b.computedAt],
    );
  }

  async get(kind: MeasurementKind, context: MeasurementContext): Promise<BaselineSummary | null> {
    const row = await this.db.getFirstAsync<{ json: string }>('SELECT json FROM physiological_baselines WHERE kind = ? AND context = ?', [kind, context]);
    return row ? parseJson<BaselineSummary | null>(row.json, null) : null;
  }

  async listAll(): Promise<BaselineSummary[]> {
    const rows = await this.db.getAllAsync<{ json: string }>('SELECT json FROM physiological_baselines ORDER BY kind');
    return rows.map((r) => parseJson<BaselineSummary | null>(r.json, null)).filter((b): b is BaselineSummary => b !== null);
  }
}

export interface AnomalyEventRow {
  id: string;
  kind: string;
  measurementId: string | null;
  sessionId: string | null;
  direction: 'elevated' | 'lower';
  robustZ: number | null;
  measuredAt: number;
  detectedAt: number;
  description: string;
}

/** Descriptive physiological deviations (never diagnoses), kept for the user's own history. */
export class AnomalyRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insertOnce(e: AnomalyEventRow): Promise<boolean> {
    if (e.measurementId) {
      const existing = await this.db.getFirstAsync<{ id: string }>('SELECT id FROM anomaly_events WHERE measurement_id = ? AND kind = ?', [e.measurementId, e.kind]);
      if (existing) return false;
    }
    await this.db.runAsync(
      `INSERT INTO anomaly_events (id, kind, measurement_id, session_id, direction, robust_z, measured_at, detected_at, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.kind, e.measurementId, e.sessionId, e.direction, e.robustZ, e.measuredAt, e.detectedAt, e.description],
    );
    return true;
  }

  async listRecent(limit: number): Promise<AnomalyEventRow[]> {
    const rows = await this.db.getAllAsync<{ id: string; kind: string; measurement_id: string | null; session_id: string | null; direction: 'elevated' | 'lower'; robust_z: number | null; measured_at: number; detected_at: number; description: string }>(
      'SELECT * FROM anomaly_events ORDER BY detected_at DESC LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, measurementId: r.measurement_id, sessionId: r.session_id, direction: r.direction, robustZ: r.robust_z, measuredAt: r.measured_at, detectedAt: r.detected_at, description: r.description }));
  }
}
