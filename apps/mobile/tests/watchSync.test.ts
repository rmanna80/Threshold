import { MINUTE_MS, resolveStandardDrinkDefinition } from '@threshold/core';
import { decodeInbound } from '../services/watch/protocol';
import { createHarness } from './support/harness';

const US = resolveStandardDrinkDefinition('US');
const beer = { serving: { value: 12, unit: 'fl_oz_us' as const }, abvPercent: 5, fractionConsumed: 1, definition: US };

describe('watch sync service', () => {
  it('pushes the open session, drinks and preferences as application context', async () => {
    const h = await createHarness({ goals: { maxStandardDrinksPerSession: 3 } });
    h.services.watchSync.start();
    await h.services.sessions.startSession({ origin: 'phone' });
    h.clock.advance(MINUTE_MS);
    await h.services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'manual' });
    await new Promise((r) => setTimeout(r, 10));
    const last = h.watch.contexts[h.watch.contexts.length - 1]!;
    expect(last.v).toBe(1);
    const ctx = JSON.parse(String(last.json));
    expect(ctx.activeSession.status).toBe('active');
    expect(ctx.drinks).toHaveLength(1);
    expect(ctx.prefs.standardDrinkGrams).toBe(14);
    expect(ctx.goals.maxStandardDrinksPerSession).toBe(3);
    // Plist-safe: only string/number values at the top level.
    expect(Object.values(last).every((v) => typeof v === 'string' || typeof v === 'number')).toBe(true);
    h.services.watchSync.stop();
  });

  it('applies watch records idempotently, acknowledges them and drops malformed ones', async () => {
    const phone = await createHarness();
    const watch = await createHarness();
    const s = await watch.services.sessions.startSession({ origin: 'watch' });
    watch.clock.advance(MINUTE_MS);
    const d = await watch.services.sessions.logDrink({ beverage: { id: null, name: 'Beer', category: 'beer' }, measurement: beer, source: 'watch' });
    if (!s.ok || !d.ok) throw new Error();
    phone.clock.set(watch.clock.now());
    const msg = { v: 1, id: 'msg-0000-0001', type: 'records', json: JSON.stringify({ sessions: [s.value], drinks: [d.value] }) };
    phone.watch.inbox.push(msg, { ...msg }, { v: 1, id: 'msg-bad-00001', type: 'records', json: '{not json' }, { v: 99, id: 'msg-future-01', type: 'records', json: '{}' });
    await phone.services.watchSync.processInbox();
    expect(phone.watch.inbox).toHaveLength(0);
    expect(await phone.services.repos.drinks.listForSession(s.value.id)).toHaveLength(1);
    // Redelivery after acknowledgement changes nothing.
    phone.watch.inbox.push(msg);
    await phone.services.watchSync.processInbox();
    expect(await phone.services.repos.drinks.listForSession(s.value.id)).toHaveLength(1);
  });

  it('decodes and validates the wire format', () => {
    expect(decodeInbound({ v: 1, id: 'abcdefgh', type: 'request_context' }).ok).toBe(true);
    expect(decodeInbound({ v: 1, id: 'x', type: 'records' }).ok).toBe(false);
    const big = decodeInbound({ v: 1, id: 'abcdefgh', type: 'records', json: JSON.stringify({ drinks: new Array(600).fill({}) }) });
    expect(big.ok).toBe(false);
  });
});
