import { MINUTE_MS, resolveStandardDrinkDefinition } from '@threshold/core';
import { createHarness, T0 } from './support/harness';

const US = resolveStandardDrinkDefinition('US');
const beer = { serving: { value: 12, unit: 'fl_oz_us' as const }, abvPercent: 5, fractionConsumed: 1, definition: US };

describe('SessionService', () => {
  it('runs the full evening lifecycle', async () => {
    const { services, clock } = await createHarness({ goals: { maxStandardDrinksPerSession: 3 } });
    const started = await services.sessions.startSession({ origin: 'phone' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.goalSnapshot.maxStandardDrinksPerSession).toBe(3);

    clock.advance(10 * MINUTE_MS);
    const d1 = await services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'quick_log' });
    expect(d1.ok).toBe(true);

    clock.advance(5 * MINUTE_MS);
    expect((await services.sessions.pause(started.value.id)).ok).toBe(true);
    clock.advance(20 * MINUTE_MS);
    const d2 = await services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
    expect(d2.ok && d2.warnings.map((w) => w.code)).toContain('auto_resumed');
    expect((await services.sessions.getOpenSession())?.status).toBe('active');

    clock.advance(60 * MINUTE_MS);
    const ended = await services.sessions.end(started.value.id);
    expect(ended.ok && ended.value.status).toBe('ended');
    expect(await services.sessions.getOpenSession()).toBeNull();
    const full = await services.sessions.getSessionWithDrinks(started.value.id);
    expect(full?.drinks).toHaveLength(2);
  });

  it('refuses to open two sessions or log without one', async () => {
    const { services } = await createHarness();
    const r = await services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('no_active_session');
    await services.sessions.startSession({ origin: 'phone' });
    const again = await services.sessions.startSession({ origin: 'phone' });
    expect(again.ok).toBe(false);
  });

  it('rejects drinks timed before the session start', async () => {
    const { services } = await createHarness();
    await services.sessions.startSession({ origin: 'phone' });
    const r = await services.sessions.logDrink({
      beverage: { id: null, name: 'Beer', category: 'beer' },
      measurement: beer,
      source: 'manual',
      consumedAt: T0 - 60 * MINUTE_MS,
    });
    expect(r.ok).toBe(false);
  });

  it('edits and deletes drinks with tombstones and notifies listeners', async () => {
    const { services, clock } = await createHarness();
    const reasons: string[] = [];
    services.sessions.subscribe((c) => {
      reasons.push(c.reason);
    });
    await services.sessions.startSession({ origin: 'phone' });
    clock.advance(MINUTE_MS);
    const d = await services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
    if (!d.ok) throw new Error();
    clock.advance(MINUTE_MS);
    const e = await services.sessions.editDrink(d.value.id, { measurement: { ...beer, fractionConsumed: 0.5 } });
    expect(e.ok && e.value.revision).toBe(2);
    const del = await services.sessions.deleteDrink(d.value.id);
    expect(del.ok && del.value.deletedAt).not.toBeNull();
    const open = await services.sessions.getOpenSession();
    expect(await services.repos.drinks.listForSession(open!.id)).toHaveLength(0);
    expect(await services.repos.drinks.listForSession(open!.id, true)).toHaveLength(1);
    expect(reasons).toEqual(['started', 'drink_added', 'drink_edited', 'drink_deleted']);
  });

  it('a failing listener never breaks logging', async () => {
    const { services } = await createHarness();
    services.sessions.subscribe(() => {
      throw new Error('boom');
    });
    expect((await services.sessions.startSession({ origin: 'phone' })).ok).toBe(true);
  });

  it('only writes to the sync outbox when cloud sync is available and enabled', async () => {
    const off = await createHarness({ cloudSync: true });
    await off.services.sessions.startSession({ origin: 'phone' });
    expect(await off.services.repos.syncQueue.pendingCount()).toBe(0);

    const on = await createHarness({ cloudSync: true, prefs: { cloudSyncEnabled: true } });
    await on.services.sessions.startSession({ origin: 'phone' });
    expect(await on.services.repos.syncQueue.pendingCount()).toBe(1);
  });

  it('ingests remote (watch) records idempotently and resolves concurrent open sessions', async () => {
    const phone = await createHarness();
    const watch = await createHarness();
    // Both devices start a session while disconnected; the watch started first.
    const w = await watch.services.sessions.startSession({ origin: 'watch' });
    phone.clock.advance(5 * MINUTE_MS);
    const p = await phone.services.sessions.startSession({ origin: 'phone' });
    if (!w.ok || !p.ok) throw new Error();
    watch.clock.advance(MINUTE_MS);
    const wd = await watch.services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'watch' });
    if (!wd.ok) throw new Error();

    const first = await phone.services.sessions.ingestRemote({ session: w.value, drinks: [wd.value] });
    expect(first.applied).toBe(2);
    expect(first.conflicts).toHaveLength(1);
    const open = await phone.services.sessions.getOpenSession();
    expect(open?.id).toBe(w.value.id); // earlier session wins
    expect((await phone.services.repos.sessions.getById(p.value.id))?.status).toBe('ended');

    const replay = await phone.services.sessions.ingestRemote({ session: w.value, drinks: [wd.value] });
    expect(replay.applied).toBe(0);
    const bad = await phone.services.sessions.ingestRemote({ drinks: [{ ...wd.value, fractionConsumed: 5 }] });
    expect(bad.rejected).toHaveLength(1);
  });
});
