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
