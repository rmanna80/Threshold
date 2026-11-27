import { MINUTE_MS, resolveStandardDrinkDefinition } from '@threshold/core';
import { alcoholicSinceLastNonAlcoholic } from '../services/interventionService';
import { createHarness } from './support/harness';

const US = resolveStandardDrinkDefinition('US');
const shot = { serving: { value: 1.5, unit: 'fl_oz_us' as const }, abvPercent: 40, fractionConsumed: 1, definition: US };
const water = { serving: { value: 8, unit: 'fl_oz_us' as const }, abvPercent: 0, fractionConsumed: 1, definition: US };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('intervention service (end-to-end with persistence and notifications)', () => {
  it('delivers one pace notification for rapid drinking and records it', async () => {
    const h = await createHarness();
    const { services, clock, notifications } = h;
    const s = await services.sessions.startSession({ origin: 'phone' });
    if (!s.ok) throw new Error();
    for (let i = 0; i < 3; i++) {
      clock.advance(5 * MINUTE_MS);
      await services.sessions.logDrink({ beverage: { id: null, name: 'Shot', category: 'spirits' }, measurement: shot, source: 'manual' });
      await flush();
    }
    expect(notifications.delivered.map((n) => n.title)).toContain('Pace check');
    const stored = await services.repos.interventions.listForSession(s.value.id);
    expect(stored.filter((e) => e.delivered && e.category === 'consumption_pace')).toHaveLength(1);
  });

  it('respects quiet mode and still records suppressed decisions', async () => {
    const h = await createHarness({ prefs: { quietMode: true } });
    const s = await h.services.sessions.startSession({ origin: 'phone' });
    if (!s.ok) throw new Error();
    for (let i = 0; i < 3; i++) {
      h.clock.advance(5 * MINUTE_MS);
      await h.services.sessions.logDrink({ beverage: { id: null, name: 'Shot', category: 'spirits' }, measurement: shot, source: 'manual' });
      await flush();
    }
    expect(h.notifications.delivered).toHaveLength(0);
    const stored = await h.services.repos.interventions.listForSession(s.value.id);
    expect(stored.every((e) => !e.delivered && e.suppressedReason === 'quiet_mode')).toBe(true);
  });

  it('notifies about the personal goal the user set', async () => {
    const h = await createHarness({ goals: { maxStandardDrinksPerSession: 1 } });
    await h.services.sessions.startSession({ origin: 'phone' });
    h.clock.advance(MINUTE_MS);
    await h.services.sessions.logDrink({ beverage: { id: null, name: 'Shot', category: 'spirits' }, measurement: shot, source: 'manual' });
    await flush();
    expect(h.notifications.delivered[0]?.body).toMatch(/goal you set/);
  });

  it('does not double-notify for drinks that were logged (and announced) on the watch', async () => {
    const phone = await createHarness();
    const watch = await createHarness();
    const s = await watch.services.sessions.startSession({ origin: 'watch' });
    if (!s.ok) throw new Error();
    const drinks = [];
    for (let i = 0; i < 3; i++) {
      watch.clock.advance(5 * MINUTE_MS);
      const d = await watch.services.sessions.logDrink({ beverage: { id: null, name: 'Shot', category: 'spirits' }, measurement: shot, source: 'watch' });
      if (d.ok) drinks.push(d.value);
    }
    phone.clock.set(watch.clock.now());
    await phone.services.sessions.ingestRemote({ session: s.value, drinks });
    await flush();
    expect(phone.notifications.delivered).toHaveLength(0);
    const recorded = await phone.services.repos.interventions.listForSession(s.value.id);
    expect(recorded.some((e) => e.suppressedReason === 'delivered_on_watch')).toBe(true);
  });

  it('counts alcoholic drinks since the last water', async () => {
    const h = await createHarness();
    await h.services.sessions.startSession({ origin: 'phone' });
    const log = async (m: typeof shot, cat: 'spirits' | 'water') => {
      h.clock.advance(20 * MINUTE_MS);
      const r = await h.services.sessions.logDrink({ beverage: { id: null, name: cat, category: cat }, measurement: m, source: 'manual' });
      if (!r.ok) throw new Error();
    };
    await log(shot, 'spirits');
    await log(water, 'water');
    await log(shot, 'spirits');
    await log(shot, 'spirits');
    const open = await h.services.sessions.getOpenSession();
    const drinks = await h.services.repos.drinks.listForSession(open!.id);
    expect(alcoholicSinceLastNonAlcoholic(drinks)).toBe(2);
  });
});
