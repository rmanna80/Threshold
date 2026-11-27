import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeDurationMs,
  buildDrinkEvent,
  countsTowardConsumption,
  createSession,
  deleteDrinkEvent,
  editDrinkEvent,
  endSession,
  isWithinSession,
  pauseSession,
  resolveStandardDrinkDefinition,
  resumeSession,
  sequentialIdGenerator,
  sessionDurationMs,
  setIdGenerator,
  MINUTE_MS,
} from '../src';

const T0 = Date.UTC(2026, 10, 27, 1, 0, 0);
const US = resolveStandardDrinkDefinition('US');

beforeEach(() => setIdGenerator(sequentialIdGenerator()));

describe('session lifecycle', () => {
  const base = () =>
    createSession({ now: T0, tzOffsetMin: -300, deviceId: 'phone-1', origin: 'phone', goals: { maxStandardDrinksPerSession: 3, paceGoalMinutesBetweenDrinks: 45 } });

  it('creates an active session with a goal snapshot', () => {
    const s = base();
    expect(s.status).toBe('active');
    expect(s.goalSnapshot.maxStandardDrinksPerSession).toBe(3);
    expect(s.revision).toBe(1);
  });

  it('pauses, resumes and ends with revision bumps', () => {
    let s = base();
    const p = pauseSession(s, T0 + 30 * MINUTE_MS, 'phone-1');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    s = p.value;
    expect(s.status).toBe('paused');
    const r = resumeSession(s, T0 + 50 * MINUTE_MS, 'phone-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.value;
    const e = endSession(s, T0 + 120 * MINUTE_MS, 'watch-1');
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    s = e.value;
    expect(s.status).toBe('ended');
    expect(s.revision).toBe(4);
    expect(s.deviceId).toBe('watch-1');
    expect(sessionDurationMs(s, T0 + 999 * MINUTE_MS)).toBe(120 * MINUTE_MS);
    expect(activeDurationMs(s, T0 + 999 * MINUTE_MS)).toBe(100 * MINUTE_MS);
  });

  it('rejects invalid transitions', () => {
    const s = base();
    expect(resumeSession(s, T0, 'x').ok).toBe(false);
    const ended = endSession(s, T0 + MINUTE_MS, 'x');
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(endSession(ended.value, T0 + 2 * MINUTE_MS, 'x').ok).toBe(false);
    expect(pauseSession(ended.value, T0 + 2 * MINUTE_MS, 'x').ok).toBe(false);
  });

  it('ending while paused closes the open pause', () => {
    const p = pauseSession(base(), T0 + 10 * MINUTE_MS, 'x');
    if (!p.ok) throw new Error('pause failed');
    const e = endSession(p.value, T0 + 40 * MINUTE_MS, 'x');
    if (!e.ok) throw new Error('end failed');
    expect(e.value.pauses[0]?.endedAt).toBe(T0 + 40 * MINUTE_MS);
    expect(activeDurationMs(e.value, T0 + 40 * MINUTE_MS)).toBe(10 * MINUTE_MS);
  });

  it('checks session membership', () => {
    const e = endSession(base(), T0 + 60 * MINUTE_MS, 'x');
    if (!e.ok) throw new Error();
    expect(isWithinSession(e.value, T0 + 30 * MINUTE_MS)).toBe(true);
    expect(isWithinSession(e.value, T0 + 61 * MINUTE_MS)).toBe(false);
  });
});

describe('drink events', () => {
  const sessionId = '00000000-0000-4000-8000-0000000000aa';
  const build = (overrides: Partial<Parameters<typeof buildDrinkEvent>[0]> = {}) =>
    buildDrinkEvent({
      sessionId,
      beverage: { id: null, name: 'Beer', category: 'beer' },
      measurement: { serving: { value: 12, unit: 'fl_oz_us' }, abvPercent: 5, fractionConsumed: 1, definition: US },
      consumedAt: T0,
      loggedAt: T0,
      tzOffsetMin: -300,
      source: 'manual',
      deviceId: 'phone-1',
      ...overrides,
    });

  it('builds a confirmed drink event', () => {
    const r = build();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standardDrinks).toBeCloseTo(1.000008, 5);
    expect(r.value.isAlcoholic).toBe(true);
    expect(countsTowardConsumption(r.value)).toBe(true);
  });

  it('treats water as non-alcoholic', () => {
    const r = build({
      beverage: { id: null, name: 'Water', category: 'water' },
      measurement: { serving: { value: 8, unit: 'fl_oz_us' }, abvPercent: 0, fractionConsumed: 1, definition: US },
    });
    expect(r.ok && r.value.isAlcoholic).toBe(false);
    if (r.ok) expect(countsTowardConsumption(r.value)).toBe(false);
  });

  it('rejects drinks logged in the future', () => {
    expect(build({ consumedAt: T0 + 60 * MINUTE_MS }).ok).toBe(false);
  });

  it('edits with revision increments and recomputes alcohol', () => {
    const r = build();
    if (!r.ok) throw new Error();
    const e = editDrinkEvent(r.value, {
      measurement: { serving: { value: 12, unit: 'fl_oz_us' }, abvPercent: 5, fractionConsumed: 0.5, definition: US },
      now: T0 + MINUTE_MS,
      deviceId: 'watch-1',
    });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.value.revision).toBe(2);
    expect(e.value.standardDrinks!).toBeCloseTo(0.500004, 5);
    expect(e.value.deviceId).toBe('watch-1');
  });

  it('soft-deletes so the tombstone can sync', () => {
    const r = build();
    if (!r.ok) throw new Error();
    const d = deleteDrinkEvent(r.value, T0 + MINUTE_MS, 'phone-1');
    expect(d.deletedAt).toBe(T0 + MINUTE_MS);
    expect(countsTowardConsumption(d)).toBe(false);
    expect(editDrinkEvent(d, { now: T0 + 2 * MINUTE_MS, deviceId: 'x', beverageName: 'y' }).ok).toBe(false);
  });

  it('never counts detector-only events', () => {
    const r = build();
    if (!r.ok) throw new Error();
    expect(countsTowardConsumption({ ...r.value, confirmation: 'detected_unconfirmed' })).toBe(false);
  });
});
