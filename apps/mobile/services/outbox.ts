import type { SyncEntityType } from '@threshold/shared-types';
import type { SyncQueueRepository } from '../database/repositories';
import { SyncQueueRepository as SQR } from '../database/repositories/syncQueue';

/**
 * Writes sync envelopes for changed entities — only while the user has cloud sync enabled.
 * When sync is enabled later, `SyncService.backfill()` enqueues the full local history.
 */
export class Outbox {
  constructor(
    private readonly queue: SyncQueueRepository,
    private readonly isEnabled: () => boolean,
    private readonly deviceId: string,
  ) {}

  async record(
    entityType: SyncEntityType,
    entity: { id: string; revision: number; updatedAt: number; deletedAt?: number | null },
    now: number,
  ): Promise<void> {
    if (!this.isEnabled()) return;
    const op = entity.deletedAt ? 'delete' : 'upsert';
    await this.queue.enqueue(
      {
        idempotencyKey: SQR.keyFor(entityType, entity.id, entity.revision, op),
        entityType,
        entityId: entity.id,
        op,
        revision: entity.revision,
        clientUpdatedAt: entity.updatedAt,
        deviceId: this.deviceId,
        // Tombstones still carry the record so the server can keep deletedAt for audit/export.
        payload: entity,
      },
      now,
    );
  }
}
