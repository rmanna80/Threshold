import type { InterventionEvent, RecoveryCheckin } from '@threshold/shared-types';
import { parseWith, recoveryCheckinSchema } from '@threshold/validation';
import { bool, fromBool, type SqlDatabase } from '../types';

interface InterventionRow {
  id: string;
  session_id: string;
  category: InterventionEvent['category'];
  message_key: string;
  title: string;
  body: string;
  priority: InterventionEvent['priority'];
  dedupe_key: string;
  triggered_at: number;
  delivered: number;
  suppressed_reason: string | null;
  acknowledged_at: number | null;
  dismissed: number;
}

const toIntervention = (r: InterventionRow): InterventionEvent => ({
  id: r.id,
  sessionId: r.session_id,
  category: r.category,
  messageKey: r.message_key,
  title: r.title,
  body: r.body,
  priority: r.priority,
  dedupeKey: r.dedupe_key,
  triggeredAt: r.triggered_at,
  delivered: fromBool(r.delivered),
  suppressedReason: r.suppressed_reason,
  acknowledgedAt: r.acknowledged_at,
  dismissed: fromBool(r.dismissed),
});

export class InterventionRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insert(e: InterventionEvent): Promise<void> {
    await this.db.runAsync(
      `INSERT OR IGNORE INTO intervention_events (id, session_id, category, message_key, title, body, priority, dedupe_key,
         triggered_at, delivered, suppressed_reason, acknowledged_at, dismissed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.sessionId, e.category, e.messageKey, e.title, e.body, e.priority, e.dedupeKey, e.triggeredAt, bool(e.delivered), e.suppressedReason, e.acknowledgedAt, bool(e.dismissed)],
    );
  }

  async listForSession(sessionId: string): Promise<InterventionEvent[]> {
    const rows = await this.db.getAllAsync<InterventionRow>(
      'SELECT * FROM intervention_events WHERE session_id = ? ORDER BY triggered_at ASC, rowid ASC',
      [sessionId],
    );
    return rows.map(toIntervention);
  }

  async acknowledge(id: string, at: number, dismissed: boolean): Promise<void> {
    await this.db.runAsync('UPDATE intervention_events SET acknowledged_at = ?, dismissed = ? WHERE id = ?', [at, bool(dismissed), id]);
  }

  async listAll(): Promise<InterventionEvent[]> {
    const rows = await this.db.getAllAsync<InterventionRow>('SELECT * FROM intervention_events ORDER BY triggered_at ASC');
    return rows.map(toIntervention);
  }
}

interface CheckinRow {
  id: string;
  session_id: string | null;
  local_date: string;
  completed_at: number;
  headache: number | null;
  fatigue: number | null;
  nausea: number | null;
  dizziness: number | null;
  sleep_quality: number | null;
  mental_clarity: number | null;
  overall_severity: number | null;
  functional_impairment: number | null;
  ate_before_drinking: number | null;
  hydration_reported: RecoveryCheckin['hydrationReported'];
  revision: number;
  updated_at: number;
  deleted_at: number | null;
}

const toCheckin = (r: CheckinRow): RecoveryCheckin => ({
  id: r.id,
  sessionId: r.session_id,
  localDate: r.local_date,
  completedAt: r.completed_at,
  headache: r.headache,
  fatigue: r.fatigue,
  nausea: r.nausea,
  dizziness: r.dizziness,
  sleepQuality: r.sleep_quality,
  mentalClarity: r.mental_clarity,
  overallSeverity: r.overall_severity,
  functionalImpairment: r.functional_impairment,
  ateBeforeDrinking: r.ate_before_drinking === null ? null : fromBool(r.ate_before_drinking),
  hydrationReported: r.hydration_reported,
  revision: r.revision,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export class CheckinRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(c: RecoveryCheckin): Promise<boolean> {
    const parsed = parseWith(recoveryCheckinSchema, c);
    if (!parsed.ok) throw new Error(`Invalid check-in: ${parsed.error}`);
    const r = await this.db.runAsync(
      `INSERT INTO recovery_checkins (id, session_id, local_date, completed_at, headache, fatigue, nausea, dizziness, sleep_quality,
         mental_clarity, overall_severity, functional_impairment, ate_before_drinking, hydration_reported, revision, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, local_date = excluded.local_date,
         completed_at = excluded.completed_at, headache = excluded.headache, fatigue = excluded.fatigue, nausea = excluded.nausea,
         dizziness = excluded.dizziness, sleep_quality = excluded.sleep_quality, mental_clarity = excluded.mental_clarity,
         overall_severity = excluded.overall_severity, functional_impairment = excluded.functional_impairment,
         ate_before_drinking = excluded.ate_before_drinking, hydration_reported = excluded.hydration_reported,
         revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
       WHERE excluded.revision > recovery_checkins.revision
          OR (excluded.revision = recovery_checkins.revision AND excluded.updated_at > recovery_checkins.updated_at)`,
      [
        c.id,
        c.sessionId,
        c.localDate,
        c.completedAt,
        c.headache,
        c.fatigue,
        c.nausea,
        c.dizziness,
        c.sleepQuality,
        c.mentalClarity,
        c.overallSeverity,
        c.functionalImpairment,
        c.ateBeforeDrinking === null ? null : bool(c.ateBeforeDrinking),
        c.hydrationReported,
        c.revision,
        c.updatedAt,
        c.deletedAt,
      ],
    );
    return r.changes > 0;
  }

  async forSession(sessionId: string): Promise<RecoveryCheckin | null> {
    const row = await this.db.getFirstAsync<CheckinRow>(
      'SELECT * FROM recovery_checkins WHERE session_id = ? AND deleted_at IS NULL ORDER BY completed_at DESC LIMIT 1',
      [sessionId],
    );
    return row ? toCheckin(row) : null;
  }

  async forDate(localDate: string): Promise<RecoveryCheckin | null> {
    const row = await this.db.getFirstAsync<CheckinRow>(
      'SELECT * FROM recovery_checkins WHERE local_date = ? AND deleted_at IS NULL ORDER BY completed_at DESC LIMIT 1',
      [localDate],
    );
    return row ? toCheckin(row) : null;
  }

  async listRecent(limit: number): Promise<RecoveryCheckin[]> {
    const rows = await this.db.getAllAsync<CheckinRow>(
      'SELECT * FROM recovery_checkins WHERE deleted_at IS NULL ORDER BY local_date DESC LIMIT ?',
      [limit],
    );
    return rows.map(toCheckin);
  }

  async listAll(includeDeleted = false): Promise<RecoveryCheckin[]> {
    const rows = await this.db.getAllAsync<CheckinRow>(
      `SELECT * FROM recovery_checkins ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY local_date ASC`,
    );
    return rows.map(toCheckin);
  }
}
