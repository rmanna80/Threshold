import type { SyncEnvelope, SyncEntityType } from '@threshold/shared-types';
import { parseJson, type SqlDatabase } from '../types';

export interface QueuedEnvelope extends SyncEnvelope {
  queueId: number;
  attempts: number;
}

/** Outbox for optional cloud sync. Envelopes are idempotent by `idempotencyKey`. */
export class SyncQueueRepository {
  constructor(private readonly db: SqlDatabase) {}

  static keyFor(entityType: SyncEntityType, entityId: string, revision: number, op: 'upsert' | 'delete'): string {
    return `${entityType}:${entityId}:${revision}:${op}`;
  }

  async enqueue(env: SyncEnvelope, now: number): Promise<void> {
    await this.db.runAsync(
      `INSERT OR IGNORE INTO sync_queue (idempotency_key, entity_type, entity_id, op, revision, payload_json, client_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [env.idempotencyKey, env.entityType, env.entityId, env.op, env.revision, env.payload === null ? null : JSON.stringify(env.payload), env.clientUpdatedAt, now],
    );
    // Superseded revisions of the same entity never need to be sent.
    await this.db.runAsync(
      `DELETE FROM sync_queue WHERE entity_type = ? AND entity_id = ? AND revision < ? AND status = 'pending'`,
      [env.entityType, env.entityId, env.revision],
    );
  }

  async nextBatch(now: number, limit: number, deviceId: string): Promise<QueuedEnvelope[]> {
    const rows = await this.db.getAllAsync<{
      id: number;
      idempotency_key: string;
      entity_type: SyncEntityType;
      entity_id: string;
      op: 'upsert' | 'delete';
      revision: number;
      payload_json: string | null;
      client_updated_at: number;
      attempts: number;
    }>(
      `SELECT id, idempotency_key, entity_type, entity_id, op, revision, payload_json, client_updated_at, attempts
       FROM sync_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id ASC LIMIT ?`,
      [now, limit],
    );
    return rows.map((r) => ({
      queueId: r.id,
      attempts: r.attempts,
      idempotencyKey: r.idempotency_key,
      entityType: r.entity_type,
      entityId: r.entity_id,
      op: r.op,
      revision: r.revision,
      clientUpdatedAt: r.client_updated_at,
      deviceId,
      payload: parseJson(r.payload_json, null),
    }));
  }

  async markDone(idempotencyKeys: string[]): Promise<void> {
    for (const key of idempotencyKeys) {
      await this.db.runAsync('DELETE FROM sync_queue WHERE idempotency_key = ?', [key]);
    }
  }

  async markRejected(idempotencyKey: string, reason: string): Promise<void> {
    await this.db.runAsync(`UPDATE sync_queue SET status = 'rejected', last_error = ? WHERE idempotency_key = ?`, [reason, idempotencyKey]);
  }

  /** Exponential backoff with cap: 30 s, 60 s, 120 s … up to 1 h. */
  async markFailed(queueIds: number[], error: string, now: number): Promise<void> {
    for (const id of queueIds) {
      const row = await this.db.getFirstAsync<{ attempts: number }>('SELECT attempts FROM sync_queue WHERE id = ?', [id]);
      const attempts = (row?.attempts ?? 0) + 1;
      const delay = Math.min(3_600_000, 30_000 * 2 ** (attempts - 1));
      await this.db.runAsync('UPDATE sync_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?', [
        attempts,
        error.slice(0, 500),
        now + delay,
        id,
      ]);
    }
  }

  async pendingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'`);
    return row?.n ?? 0;
  }

  async clear(): Promise<void> {
    await this.db.runAsync('DELETE FROM sync_queue');
  }
}

/** Remembers processed inbound message ids (watch/WatchConnectivity, backend pulls) for idempotency. */
export class ProcessedMessageRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Returns true if the id was newly recorded, false if it had already been processed. */
  async markProcessed(messageId: string, source: string, now: number): Promise<boolean> {
    const r = await this.db.runAsync('INSERT OR IGNORE INTO processed_messages (message_id, source, processed_at) VALUES (?, ?, ?)', [
      messageId,
      source,
      now,
    ]);
    return r.changes > 0;
  }

  async prune(olderThan: number): Promise<void> {
    await this.db.runAsync('DELETE FROM processed_messages WHERE processed_at < ?', [olderThan]);
  }
}
