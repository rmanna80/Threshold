import type { SessionFeatures } from '@threshold/core';
import type { ModelPrediction } from '@threshold/shared-types';
import { parseJson, type SqlDatabase } from '../types';

/** Derived per-session features (spec sf-v1). Recomputed whenever inputs change; never synced. */
export class SessionFeatureRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(sessionId: string, f: SessionFeatures, computedAt: number): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO session_features (session_id, feature_version, json, data_quality, computed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET feature_version = excluded.feature_version, json = excluded.json,
         data_quality = excluded.data_quality, computed_at = excluded.computed_at`,
      [sessionId, f.version, JSON.stringify(f), f.dataQuality, computedAt],
    );
  }

  async get(sessionId: string): Promise<SessionFeatures | null> {
    const row = await this.db.getFirstAsync<{ json: string }>('SELECT json FROM session_features WHERE session_id = ?', [sessionId]);
    return parseJson<SessionFeatures | null>(row?.json, null);
  }

  async listAll(): Promise<{ sessionId: string; features: SessionFeatures; computedAt: number }[]> {
    const rows = await this.db.getAllAsync<{ session_id: string; json: string; computed_at: number }>('SELECT session_id, json, computed_at FROM session_features ORDER BY computed_at ASC');
    return rows.flatMap((r) => {
      const f = parseJson<SessionFeatures | null>(r.json, null);
      return f ? [{ sessionId: r.session_id, features: f, computedAt: r.computed_at }] : [];
    });
  }
}

interface PredictionRow {
  id: string;
  session_id: string | null;
  model_id: string;
  model_version: string;
  predicted_at: number;
  input_quality: ModelPrediction['inputQuality'];
  feature_availability_json: string;
  probability: number | null;
  interval_json: string | null;
  status: ModelPrediction['status'];
  withheld_reason: string | null;
}

const toPrediction = (r: PredictionRow): ModelPrediction => ({
  id: r.id,
  sessionId: r.session_id,
  modelId: r.model_id,
  modelVersion: r.model_version,
  predictedAt: r.predicted_at,
  inputQuality: r.input_quality,
  featureAvailability: parseJson<Record<string, boolean>>(r.feature_availability_json, {}),
  probability: r.probability,
  interval: parseJson<[number, number] | null>(r.interval_json, null),
  status: r.status,
  withheldReason: r.withheld_reason,
});

/** Audit log of every prediction decision (shown or withheld), one row per session × model version. */
export class ModelPredictionRepository {
  constructor(private readonly db: SqlDatabase) {}

  async record(p: ModelPrediction): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM model_predictions WHERE session_id IS ? AND model_id = ? AND model_version = ?', [p.sessionId, p.modelId, p.modelVersion]);
      await this.db.runAsync(
        `INSERT INTO model_predictions (id, session_id, model_id, model_version, predicted_at, input_quality, feature_availability_json, probability, interval_json, status, withheld_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.sessionId, p.modelId, p.modelVersion, p.predictedAt, p.inputQuality, JSON.stringify(p.featureAvailability), p.probability, p.interval ? JSON.stringify(p.interval) : null, p.status, p.withheldReason],
      );
    });
  }

  async listForSession(sessionId: string): Promise<ModelPrediction[]> {
    const rows = await this.db.getAllAsync<PredictionRow>('SELECT * FROM model_predictions WHERE session_id = ? ORDER BY predicted_at ASC', [sessionId]);
    return rows.map(toPrediction);
  }

  async listAll(): Promise<ModelPrediction[]> {
    const rows = await this.db.getAllAsync<PredictionRow>('SELECT * FROM model_predictions ORDER BY predicted_at ASC');
    return rows.map(toPrediction);
  }
}
