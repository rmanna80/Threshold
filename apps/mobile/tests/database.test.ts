import { createSession, resolveStandardDrinkDefinition, buildDrinkEvent, editDrinkEvent } from '@threshold/core';
import { LATEST_SCHEMA_VERSION, migrate } from '../database/migrations';
import { createRepositories } from '../database/repositories';
import { createTestDatabase } from './support/sqljsDatabase';

const T0 = Date.UTC(2026, 10, 28, 1, 0, 0);
const US = resolveStandardDrinkDefinition('US');

describe('migrations', () => {
  it('applies all migrations once and is idempotent', async () => {
    const db = await createTestDatabase({ migrate: false });
    expect(await migrate(db, () => T0)).toEqual([LATEST_SCHEMA_VERSION]);
    expect(await migrate(db, () => T0)).toEqual([]);
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    const names = tables.map((t) => t.name);
    for (const t of ['drinking_sessions', 'drink_events', 'sync_queue', 'measurements', 'recovery_checkins', 'user_consents']) {
      expect(names).toContain(t);
    }
  });

  it('enforces CHECK constraints at the storage layer', async () => {
    const db = await createTestDatabase();
    await expect(
      db.runAsync(
        `INSERT INTO beverages (id, name, category, serving_value, serving_unit, abv_percent, created_at, updated_at) VALUES ('b', 'x', 'beer', 12, 'fl_oz_us', 150, 1, 1)`,
      ),
    ).rejects.toThrow();
  });
});

describe('repositories', () => {
  it('persists sessions and drinks and restores them after "app termination"', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    const session = createSession({ now: T0, tzOffsetMin: -300, deviceId: 'phone', origin: 'phone', goals: null });
    await repos.sessions.upsert(session);
    const drink = buildDrinkEvent({
      sessionId: session.id,
      beverage: { id: null, name: 'Beer', category: 'beer' },
      measurement: { serving: { value: 12, unit: 'fl_oz_us' }, abvPercent: 5, fractionConsumed: 1, definition: US },
      consumedAt: T0 + 60_000,
      loggedAt: T0 + 60_000,
      tzOffsetMin: -300,
      source: 'manual',
      deviceId: 'phone',
    });
    if (!drink.ok) throw new Error('drink');
    await repos.drinks.upsert(drink.value);

    // A fresh repository set over the same database simulates relaunch.
    const reopened = createRepositories(db);
    const open = await reopened.sessions.getOpen();
    expect(open?.id).toBe(session.id);
    const drinks = await reopened.drinks.listForSession(session.id);
    expect(drinks).toHaveLength(1);
    expect(drinks[0]).toEqual(drink.value);
  });

  it('ignores duplicate and stale writes (revision guard)', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    const session = createSession({ now: T0, tzOffsetMin: 0, deviceId: 'a', origin: 'phone', goals: null });
    await repos.sessions.upsert(session);
    const built = buildDrinkEvent({
      sessionId: session.id,
      beverage: { id: null, name: 'Wine', category: 'wine' },
      measurement: { serving: { value: 150, unit: 'ml' }, abvPercent: 12, fractionConsumed: 1, definition: US },
      consumedAt: T0,
      loggedAt: T0,
      tzOffsetMin: 0,
      source: 'manual',
      deviceId: 'a',
    });
    if (!built.ok) throw new Error();
    expect(await repos.drinks.upsert(built.value)).toBe(true);
    expect(await repos.drinks.upsert(built.value)).toBe(false); // duplicate delivery
    const edited = editDrinkEvent(built.value, {
      measurement: { serving: { value: 150, unit: 'ml' }, abvPercent: 12, fractionConsumed: 0.5, definition: US },
      now: T0 + 1000,
      deviceId: 'b',
    });
    if (!edited.ok) throw new Error();
    expect(await repos.drinks.upsert(edited.value)).toBe(true);
    expect(await repos.drinks.upsert(built.value)).toBe(false); // stale revision arriving late
    expect((await repos.drinks.getById(built.value.id))?.fractionConsumed).toBe(0.5);
  });

  it('rejects invalid records before they reach storage', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    const session = createSession({ now: T0, tzOffsetMin: 0, deviceId: 'a', origin: 'phone', goals: null });
    await expect(repos.sessions.upsert({ ...session, id: 'nope' })).rejects.toThrow(/Invalid session/);
  });

  it('keeps an append-only consent history and reports the latest decision', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    await repos.settings.recordConsent({ id: '00000000-0000-4000-8000-000000000001', type: 'healthkit', granted: true, version: 'v1', recordedAt: 1 });
    await repos.settings.recordConsent({ id: '00000000-0000-4000-8000-000000000002', type: 'healthkit', granted: false, version: 'v1', recordedAt: 2 });
    expect((await repos.settings.latestConsents()).healthkit?.granted).toBe(false);
    expect(await repos.settings.consentHistory()).toHaveLength(2);
  });

  it('dedupes sync envelopes and drops superseded revisions', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    const base = { entityType: 'drink_event' as const, entityId: '00000000-0000-4000-8000-0000000000aa', op: 'upsert' as const, clientUpdatedAt: 1, deviceId: 'd', payload: {} };
    await repos.syncQueue.enqueue({ ...base, idempotencyKey: 'k1', revision: 1 }, 1);
    await repos.syncQueue.enqueue({ ...base, idempotencyKey: 'k1', revision: 1 }, 1);
    expect(await repos.syncQueue.pendingCount()).toBe(1);
    await repos.syncQueue.enqueue({ ...base, idempotencyKey: 'k2', revision: 2 }, 2);
    const batch = await repos.syncQueue.nextBatch(10, 10, 'd');
    expect(batch.map((b) => b.revision)).toEqual([2]);
    await repos.syncQueue.markFailed([batch[0]!.queueId], 'offline', 100);
    expect(await repos.syncQueue.nextBatch(100, 10, 'd')).toHaveLength(0); // backoff
    expect(await repos.syncQueue.nextBatch(100 + 30_000, 10, 'd')).toHaveLength(1);
  });

  it('records processed message ids exactly once', async () => {
    const db = await createTestDatabase();
    const repos = createRepositories(db);
    expect(await repos.processedMessages.markProcessed('m1', 'watch', 1)).toBe(true);
    expect(await repos.processedMessages.markProcessed('m1', 'watch', 2)).toBe(false);
  });
});
