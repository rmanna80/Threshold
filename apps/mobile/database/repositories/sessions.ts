import type { DrinkingSession } from '@threshold/shared-types';
import { drinkingSessionSchema, parseWith } from '@threshold/validation';
import { parseJson, type SqlDatabase } from '../types';

interface SessionRow {
  id: string;
  status: DrinkingSession['status'];
  started_at: number;
  ended_at: number | null;
  tz_offset_min: number;
  pauses_json: string;
  start_context_json: string;
  goal_snapshot_json: string;
  origin: DrinkingSession['origin'];
  revision: number;
  updated_at: number;
  deleted_at: number | null;
  device_id: string;
}

function toSession(r: SessionRow): DrinkingSession {
  return {
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    tzOffsetMin: r.tz_offset_min,
    pauses: parseJson(r.pauses_json, []),
    startContext: parseJson(r.start_context_json, {
      restingHeartRateBpm: null,
      hrvSdnnMs: null,
      lastNightSleepMinutes: null,
      healthDataAuthorized: false,
    }),
    goalSnapshot: parseJson(r.goal_snapshot_json, { maxStandardDrinksPerSession: null, paceGoalMinutesBetweenDrinks: null }),
    origin: r.origin,
    revision: r.revision,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    deviceId: r.device_id,
  };
}

export class SessionRepository {
  constructor(private readonly db: SqlDatabase) {}

  /**
   * Upsert with revision guard: an incoming record replaces the stored one only if it is newer
   * (higher revision, or same revision with later updatedAt). Returns whether it was applied.
   */
  async upsert(session: DrinkingSession): Promise<boolean> {
    const parsed = parseWith(drinkingSessionSchema, session);
    if (!parsed.ok) throw new Error(`Invalid session: ${parsed.error}`);
    const s = parsed.value;
    const result = await this.db.runAsync(
      `INSERT INTO drinking_sessions (id, status, started_at, ended_at, tz_offset_min, pauses_json, start_context_json,
         goal_snapshot_json, origin, revision, updated_at, deleted_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, started_at = excluded.started_at, ended_at = excluded.ended_at,
         tz_offset_min = excluded.tz_offset_min, pauses_json = excluded.pauses_json,
         start_context_json = excluded.start_context_json, goal_snapshot_json = excluded.goal_snapshot_json,
         origin = excluded.origin, revision = excluded.revision, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at, device_id = excluded.device_id
       WHERE excluded.revision > drinking_sessions.revision
          OR (excluded.revision = drinking_sessions.revision AND excluded.updated_at > drinking_sessions.updated_at)`,
      [
        s.id,
        s.status,
        s.startedAt,
        s.endedAt,
        s.tzOffsetMin,
        JSON.stringify(s.pauses),
        JSON.stringify(s.startContext),
        JSON.stringify(s.goalSnapshot),
        s.origin,
        s.revision,
        s.updatedAt,
        s.deletedAt,
        s.deviceId,
      ],
    );
    return result.changes > 0;
  }

  async getById(id: string): Promise<DrinkingSession | null> {
    const row = await this.db.getFirstAsync<SessionRow>('SELECT * FROM drinking_sessions WHERE id = ?', [id]);
    return row ? toSession(row) : null;
  }

  /** The most recent non-ended, non-deleted session (there should be at most one). */
  async getOpen(): Promise<DrinkingSession | null> {
    const row = await this.db.getFirstAsync<SessionRow>(
      `SELECT * FROM drinking_sessions WHERE status != 'ended' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    );
    return row ? toSession(row) : null;
  }

  async listOpen(): Promise<DrinkingSession[]> {
    const rows = await this.db.getAllAsync<SessionRow>(
      `SELECT * FROM drinking_sessions WHERE status != 'ended' AND deleted_at IS NULL ORDER BY started_at DESC`,
    );
    return rows.map(toSession);
  }

  async listRecent(limit: number, before: number | null = null): Promise<DrinkingSession[]> {
    const rows = await this.db.getAllAsync<SessionRow>(
      `SELECT * FROM drinking_sessions WHERE deleted_at IS NULL AND (? IS NULL OR started_at < ?)
       ORDER BY started_at DESC LIMIT ?`,
      [before, before, limit],
    );
    return rows.map(toSession);
  }

  async listBetween(fromMs: number, toMs: number): Promise<DrinkingSession[]> {
    const rows = await this.db.getAllAsync<SessionRow>(
      `SELECT * FROM drinking_sessions WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ? ORDER BY started_at ASC`,
      [fromMs, toMs],
    );
    return rows.map(toSession);
  }

  async listAll(includeDeleted = false): Promise<DrinkingSession[]> {
    const rows = await this.db.getAllAsync<SessionRow>(
      `SELECT * FROM drinking_sessions ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY started_at ASC`,
    );
    return rows.map(toSession);
  }
}
