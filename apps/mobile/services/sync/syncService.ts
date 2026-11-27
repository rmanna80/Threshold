import type { RecoveryCheckin } from '@threshold/shared-types';
import { parseWith, recoveryCheckinSchema, z } from '@threshold/validation';
import type { Repositories } from '../../database/repositories';
import type { Clock } from '../clock';
import type { Outbox } from '../outbox';
import type { SessionService } from '../sessionService';
import type { ApiClient } from './apiClient';

const ackSchema = z.object({
  acks: z.array(
    z.object({
      idempotencyKey: z.string(),
      status: z.enum(['applied', 'duplicate', 'stale', 'rejected', 'deferred']),
      serverRevision: z.number(),
      reason: z.string().nullable().optional(),
    }),
  ),
});

const pullSchema = z.object({
  changes: z.array(
    z.object({
      seq: z.number(),
      entityType: z.string(),
      entityId: z.string(),
      revision: z.number(),
      clientUpdatedAt: z.number(),
      deviceId: z.string(),
      deleted: z.boolean(),
      payload: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  nextCursor: z.number(),
  hasMore: z.boolean(),
});

export interface SyncResult {
  pushed: number;
  pulled: number;
  rejected: number;
  deferred: number;
}

/**
 * Optional cloud sync: push the outbox, then pull changes since the stored cursor. Every pulled
 * record is validated and revision-guarded, so replays and out-of-order pages are harmless.
 */
export class SyncService {
  private running: Promise<SyncResult> | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly repos: Repositories,
    private readonly sessions: SessionService,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly deviceId: string,
  ) {}

  syncNow(): Promise<SyncResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, rejected: 0, deferred: 0 };
    // Push in batches until the queue is drained (or only backing-off items remain).
    for (let i = 0; i < 20; i++) {
      const batch = await this.repos.syncQueue.nextBatch(this.clock.now(), 100, this.deviceId);
      if (batch.length === 0) break;
      try {
        const parsed = ackSchema.safeParse(await this.api.push(batch.map(({ queueId: _q, attempts: _a, ...env }) => env)));
        if (!parsed.success) throw new Error('Malformed push response');
        const done: string[] = [];
        for (const a of parsed.data.acks) {
          if (a.status === 'applied' || a.status === 'duplicate' || a.status === 'stale') done.push(a.idempotencyKey);
          else if (a.status === 'rejected') {
            result.rejected += 1;
            await this.repos.syncQueue.markRejected(a.idempotencyKey, a.reason ?? 'rejected');
          } else {
            result.deferred += 1;
            const item = batch.find((b) => b.idempotencyKey === a.idempotencyKey);
            if (item) await this.repos.syncQueue.markFailed([item.queueId], a.reason ?? 'deferred', this.clock.now());
          }
        }
        await this.repos.syncQueue.markDone(done);
        result.pushed += done.length;
      } catch (e) {
        await this.repos.syncQueue.markFailed(batch.map((b) => b.queueId), e instanceof Error ? e.message : 'sync failed', this.clock.now());
        throw e;
      }
    }

    let cursor = Number((await this.repos.kv.get('sync_cursor')) ?? '0');
    for (let page = 0; page < 50; page++) {
      const parsed = pullSchema.safeParse(await this.api.pull(cursor));
      if (!parsed.success) throw new Error('Malformed pull response');
      for (const c of parsed.data.changes) {
        if (!c.payload) continue;
        result.pulled += await this.applyChange(c.entityType, c.payload);
      }
      cursor = parsed.data.nextCursor;
      await this.repos.kv.set('sync_cursor', String(cursor), this.clock.now());
      if (!parsed.data.hasMore) break;
    }
    await this.repos.kv.set('sync_last_success', String(this.clock.now()), this.clock.now());
    return result;
  }

  private async applyChange(entityType: string, payload: Record<string, unknown>): Promise<number> {
    switch (entityType) {
      case 'drinking_session':
        return (await this.sessions.ingestRemote({ session: payload }, { fromCloud: true })).applied;
      case 'drink_event':
        return (await this.sessions.ingestRemote({ drinks: [payload] }, { fromCloud: true })).applied;
      case 'recovery_checkin': {
        const c = parseWith(recoveryCheckinSchema, payload);
        return c.ok && (await this.repos.checkins.upsert(c.value as RecoveryCheckin)) ? 1 : 0;
      }
      default:
        // Goals, preferences, consents and intervention history are device-authoritative in v1:
        // they are backed up to the server but not overwritten from it.
        return 0;
    }
  }

  /** Enqueue the entire local history (used when the user turns sync on). */
  async backfill(): Promise<number> {
    const now = this.clock.now();
    let n = 0;
    for (const s of await this.repos.sessions.listAll(true)) {
      await this.outbox.record('drinking_session', s, now);
      n++;
    }
    for (const d of await this.repos.drinks.listAll(true)) {
      await this.outbox.record('drink_event', d, now);
      n++;
    }
    for (const c of await this.repos.checkins.listAll(true)) {
      await this.outbox.record('recovery_checkin', c, now);
      n++;
    }
    for (const c of await this.repos.settings.consentHistory()) {
      await this.outbox.record('consent_record', { ...c, revision: 1, updatedAt: c.recordedAt }, now);
      n++;
    }
    return n;
  }
}
