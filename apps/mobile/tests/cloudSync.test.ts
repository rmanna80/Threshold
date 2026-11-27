import { MINUTE_MS, resolveStandardDrinkDefinition } from '@threshold/core';
import { ApiClient, assertSecureBaseUrl, type FetchLike } from '../services/sync/apiClient';
import { MemoryTokenStore } from '../services/sync/secureTokenStore';
import { SyncService } from '../services/sync/syncService';
import { createHarness } from './support/harness';

const US = resolveStandardDrinkDefinition('US');
const beer = { serving: { value: 12, unit: 'fl_oz_us' as const }, abvPercent: 5, fractionConsumed: 1, definition: US };

/** A tiny in-memory stand-in for the backend's push/pull contract. */
function fakeServer() {
  const store = new Map<string, { entityType: string; revision: number; payload: Record<string, unknown>; seq: number }>();
  let seq = 0;
  let fail401Once = false;
  const fetchImpl: FetchLike = async (url, init) => {
    const path = url.replace('https://api.test', '');
    const json = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body });
    if (path.startsWith('/v1/auth/login')) return json(200, { accessToken: 'a1', refreshToken: 'r1'.padEnd(30, 'x') });
    if (path.startsWith('/v1/auth/refresh')) return json(200, { accessToken: 'a2', refreshToken: 'r2'.padEnd(30, 'x') });
    if (fail401Once) {
      fail401Once = false;
      return json(401, { detail: 'expired' });
    }
    if (path.startsWith('/v1/sync/push')) {
      const body = JSON.parse(init?.body ?? '{}') as { envelopes: { idempotencyKey: string; entityType: string; entityId: string; revision: number; payload: Record<string, unknown> }[] };
      const acks = body.envelopes.map((e) => {
        const cur = store.get(e.entityId);
        if (cur && cur.revision >= e.revision) return { idempotencyKey: e.idempotencyKey, status: 'stale', serverRevision: cur.revision };
        store.set(e.entityId, { entityType: e.entityType, revision: e.revision, payload: e.payload, seq: ++seq });
        return { idempotencyKey: e.idempotencyKey, status: 'applied', serverRevision: e.revision };
      });
      return json(200, { acks });
    }
    if (path.startsWith('/v1/sync/pull')) {
      const cursor = Number(new URL(url).searchParams.get('cursor') ?? 0);
      const changes = [...store.entries()]
        .filter(([, v]) => v.seq > cursor)
        .sort((a, b) => a[1].seq - b[1].seq)
        .map(([id, v]) => ({ seq: v.seq, entityType: v.entityType, entityId: id, revision: v.revision, clientUpdatedAt: 0, deviceId: 'x', deleted: false, payload: v.payload }));
      return json(200, { changes, nextCursor: changes.length ? changes[changes.length - 1]!.seq : cursor, hasMore: false });
    }
    return json(404, { detail: 'not found' });
  };
  return { fetchImpl, store, expireNext: () => (fail401Once = true) };
}

describe('cloud sync', () => {
  it('refuses insecure servers', () => {
    expect(() => assertSecureBaseUrl('http://api.example.com', false)).toThrow(/HTTPS/);
    expect(() => assertSecureBaseUrl('http://localhost:8000', true)).not.toThrow();
    expect(() => assertSecureBaseUrl('https://api.example.com', false)).not.toThrow();
  });

  it('pushes the outbox, refreshes expired tokens and restores data on a second device', async () => {
    const server = fakeServer();
    const phoneA = await createHarness({ cloudSync: true, prefs: { cloudSyncEnabled: true } });
    const apiA = new ApiClient('https://api.test', new MemoryTokenStore(), phoneA.services.deviceId, server.fetchImpl);
    await apiA.signIn('login', 'a@example.com', 'long password!');
    const syncA = new SyncService(apiA, phoneA.services.repos, phoneA.services.sessions, phoneA.services.outbox, phoneA.clock, phoneA.services.deviceId);

    const s = await phoneA.services.sessions.startSession({ origin: 'phone' });
    phoneA.clock.advance(MINUTE_MS);
    await phoneA.services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
    if (!s.ok) throw new Error();
    server.expireNext();
    const r = await syncA.syncNow();
    expect(r.pushed).toBeGreaterThanOrEqual(2);
    expect(await phoneA.services.repos.syncQueue.pendingCount()).toBe(0);

    const phoneB = await createHarness({ cloudSync: true, prefs: { cloudSyncEnabled: true } });
    const apiB = new ApiClient('https://api.test', new MemoryTokenStore(), phoneB.services.deviceId, server.fetchImpl);
    await apiB.signIn('login', 'a@example.com', 'long password!');
    const syncB = new SyncService(apiB, phoneB.services.repos, phoneB.services.sessions, phoneB.services.outbox, phoneB.clock, phoneB.services.deviceId);
    const pulled = await syncB.syncNow();
    expect(pulled.pulled).toBeGreaterThanOrEqual(2);
    expect(await phoneB.services.repos.drinks.listForSession(s.value.id)).toHaveLength(1);
    // Pulled records are not echoed back into B's outbox.
    expect(await phoneB.services.repos.syncQueue.pendingCount()).toBe(0);
  });

  it('backfills local history when sync is turned on later', async () => {
    const server = fakeServer();
    const h = await createHarness({ cloudSync: true });
    await h.services.sessions.startSession({ origin: 'phone' });
    expect(await h.services.repos.syncQueue.pendingCount()).toBe(0);
    h.prefs.current = { ...h.prefs.current, cloudSyncEnabled: true };
    const api = new ApiClient('https://api.test', new MemoryTokenStore(), h.services.deviceId, server.fetchImpl);
    const sync = new SyncService(api, h.services.repos, h.services.sessions, h.services.outbox, h.clock, h.services.deviceId);
    expect(await sync.backfill()).toBeGreaterThanOrEqual(1);
    expect(await h.services.repos.syncQueue.pendingCount()).toBeGreaterThanOrEqual(1);
  });
});
