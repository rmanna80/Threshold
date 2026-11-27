import { beforeEach, describe, expect, it } from 'vitest';
import type { InterventionEvent } from '@threshold/shared-types';
import {
  ALCOHOL_POISONING_SIGNS,
  FREQUENCY_POLICIES,
  MESSAGE_CATALOG,
  PaceTracker,
  checkMessage,
  emergencyNumberFor,
  evaluateInterventions,
  isSafeMessage,
  resolveStandardDrinkDefinition,
  sequentialIdGenerator,
  sessionRecommendation,
  setIdGenerator,
  type InterventionContext,
  type PaceEvent,
} from '../src';
import { MINUTE_MS } from '../src/time';

const start = Date.UTC(2026, 10, 28, 1);
const US = resolveStandardDrinkDefinition('US');
const ev = (id: string, min: number, std: number | null = 1): PaceEvent => ({
  id,
  consumedAt: start + min * MINUTE_MS,
  standardDrinks: std,
  ethanolGrams: std === null ? null : std * 14,
  revision: 1,
  updatedAt: start + min * MINUTE_MS,
  counts: true,
});

beforeEach(() => setIdGenerator(sequentialIdGenerator()));

function ctx(events: PaceEvent[], nowMin: number, overrides: Partial<InterventionContext> = {}): InterventionContext {
  const now = start + nowMin * MINUTE_MS;
  const pace = new PaceTracker(start, undefined, events).snapshot(now);
  const sorted = [...events].sort((a, b) => a.consumedAt - b.consumedAt);
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  return {
    now,
    sessionId: '00000000-0000-4000-8000-0000000000aa',
    sessionStartedAt: start,
    pace,
    goals: { maxStandardDrinksPerSession: null, paceGoalMinutesBetweenDrinks: null },
    weekly: null,
    objectives: [],
    frequency: 'standard',
    quietMode: false,
    definition: US,
    alcoholicSinceLastNonAlcoholic: 0,
    lastIntervalMs: last && prev ? last.consumedAt - prev.consumedAt : null,
    lastDrinkId: last?.id ?? null,
    physiology: null,
    history: [],
    ...overrides,
  };
}

function replay(base: InterventionContext, history: InterventionEvent[]): InterventionContext {
  return { ...base, history };
}

describe('safety guard', () => {
  it('approves every message in the intervention catalogue', () => {
    for (const [key, m] of Object.entries(MESSAGE_CATALOG)) {
      expect(isSafeMessage(m.title), key).toBe(true);
      expect(isSafeMessage(m.body.replace('{age}', '5 min ago')), key).toBe(true);
    }
  });

  it.each([
    'You are sober now.',
    'You are safe to drive.',
    'Your estimated BAC is 0.04.',
    'Your blood alcohol is dropping.',
    'Follow this plan for a hangover-free morning.',
    'This will prevent a hangover.',
    'Guaranteed to keep you fine.',
    'You are within a safe limit.',
    'Go ahead and have another one!',
    'Your next drink in 20 minutes.',
    'You are cleared to drink again.',
    'Water will help you sober up faster.',
    'Coffee speeds up alcohol elimination.',
    'Your heart rate proves you are intoxicated.',
    'This is not alcohol poisoning.',
    "You're fine.",
  ])('blocks: %s', (text) => {
    expect(checkMessage(text).safe).toBe(false);
  });

  it('allows ordinary moderation language', () => {
    expect(isSafeMessage('Consider switching to water or a non-alcoholic beverage.')).toBe(true);
    expect(isSafeMessage('Consider ending alcohol consumption for the evening.')).toBe(true);
  });
});

describe('emergency information', () => {
  it('lists critical signs and resolves regional numbers', () => {
    expect(ALCOHOL_POISONING_SIGNS.length).toBeGreaterThanOrEqual(6);
    expect(emergencyNumberFor('US').primary).toBe('911');
    expect(emergencyNumberFor('gb').primary).toBe('999');
    expect(emergencyNumberFor('AU').primary).toBe('000');
    expect(emergencyNumberFor('DE').primary).toBe('112');
    expect(emergencyNumberFor('ZZ').primary).toBe('112');
    expect(emergencyNumberFor(null).notes).toMatch(/confirm/);
  });
});

describe('intervention engine', () => {
  it('fires a pace intervention for rapid consumption, then dedupes it', () => {
    const c = ctx([ev('a', 5), ev('b', 12), ev('c', 20)], 22);
    const first = evaluateInterventions(c);
    expect(first.decision.deliver?.category).toBe('consumption_pace');
    expect(first.events.filter((e) => e.delivered)).toHaveLength(1);
    const second = evaluateInterventions(replay(c, first.events));
    expect(second.decision.deliver?.messageKey).not.toBe('pace.rapid');
  });

  it('prioritises personal goals and lets them bypass the global gap', () => {
    const base = ctx([ev('a', 5), ev('b', 12), ev('c', 20)], 22, {
      goals: { maxStandardDrinksPerSession: 3, paceGoalMinutesBetweenDrinks: null },
    });
    const r = evaluateInterventions(base);
    expect(r.decision.deliver?.messageKey).toBe('goal.session_reached');
    const next = evaluateInterventions(replay({ ...base, now: base.now + MINUTE_MS }, r.events));
    // The pace intervention is deferred by the minimum gap, not dropped.
    expect(next.decision.deliver).toBeNull();
    expect(next.decision.deferred.map((d) => d.candidate.category)).toContain('consumption_pace');
    const later = evaluateInterventions(replay({ ...base, now: base.now + 20 * MINUTE_MS }, r.events));
    expect(later.decision.deliver?.category).toBe('consumption_pace');
  });

  it('describes goals as personal, never as safety limits', () => {
    expect(MESSAGE_CATALOG['goal.session_reached'].body).toMatch(/goal you set/);
    for (const m of Object.values(MESSAGE_CATALOG)) expect(m.body).not.toMatch(/safe|limit/i);
  });

  it('honours quiet mode (only personal goals are delivered)', () => {
    const r = evaluateInterventions(ctx([ev('a', 5), ev('b', 12), ev('c', 20)], 22, { quietMode: true }));
    expect(r.decision.deliver).toBeNull();
    expect(r.decision.suppressed.every((s) => s.reason === 'quiet_mode')).toBe(true);
    const g = evaluateInterventions(ctx([ev('a', 5), ev('b', 12)], 22, { quietMode: true, goals: { maxStandardDrinksPerSession: 2, paceGoalMinutesBetweenDrinks: null } }));
    expect(g.decision.deliver?.category).toBe('personal_goal');
  });

  it('filters by notification frequency', () => {
    const r = evaluateInterventions(ctx([ev('a', 5), ev('b', 60)], 62, { frequency: 'minimal', alcoholicSinceLastNonAlcoholic: 2 }));
    expect(r.decision.deliver).toBeNull();
    expect(r.decision.suppressed[0]?.reason).toBe('frequency_preference');
  });

  it('caps notifications per session', () => {
    const delivered: InterventionEvent[] = Array.from({ length: FREQUENCY_POLICIES.standard.maxPerSession }, (_, i) => ({
      id: `00000000-0000-4000-8000-00000000010${i}`,
      sessionId: 's',
      category: 'nonalcoholic_alternative',
      messageKey: 'alternative.switch',
      title: 't',
      body: 'b',
      priority: 2,
      dedupeKey: `old:${i}`,
      triggeredAt: start,
      delivered: true,
      suppressedReason: null,
      acknowledgedAt: null,
      dismissed: false,
    }));
    const r = evaluateInterventions(ctx([ev('a', 195), ev('b', 196), ev('c', 198)], 200, { history: delivered }));
    expect(r.decision.deliver).toBeNull();
    expect(r.decision.suppressed.some((s) => s.reason === 'session_cap')).toBe(true);
  });

  it('backs off when the user keeps dismissing prompts (fatigue)', () => {
    const mk = (min: number, dismissed: boolean, key: string): InterventionEvent => ({
      id: `00000000-0000-4000-8000-0000000002${String(min).padStart(2, '0')}`,
      sessionId: 's',
      category: 'recovery_awareness',
      messageKey: 'x',
      title: 't',
      body: 'b',
      priority: 3,
      dedupeKey: key,
      triggeredAt: start + min * MINUTE_MS,
      delivered: true,
      suppressedReason: null,
      acknowledgedAt: null,
      dismissed,
    });
    const history = [mk(0, true, 'k1'), mk(20, true, 'k2')];
    // 20 minutes after the last prompt: normally past the 15-min gap, but fatigue doubles it to 30.
    const r = evaluateInterventions(ctx([ev('a', 30), ev('b', 38), ev('c', 39)], 40, { history }));
    expect(r.decision.deliver).toBeNull();
    expect(r.decision.deferred.some((d) => d.reason === 'min_gap')).toBe(true);
  });

  it('only describes physiology with a mature baseline and a fresh reading', () => {
    const fresh = { direction: 'elevated' as const, measuredAt: start + 25 * MINUTE_MS, baselineMature: true, measurementId: 'hk-1' };
    const ok = evaluateInterventions(ctx([], 30, { frequency: 'frequent', physiology: { heartRate: fresh } }));
    expect(ok.decision.deliver?.category).toBe('physiological_change');
    expect(ok.decision.deliver?.body).toMatch(/5 min ago/);
    const stale = evaluateInterventions(ctx([], 60, { frequency: 'frequent', physiology: { heartRate: fresh } }));
    expect(stale.decision.deliver).toBeNull();
    const immature = evaluateInterventions(ctx([], 30, { frequency: 'frequent', physiology: { heartRate: { ...fresh, baselineMature: false } } }));
    expect(immature.decision.deliver).toBeNull();
  });

  it('suggests ending the session when well above the personal goal', () => {
    const r = evaluateInterventions(ctx([ev('a', 5), ev('b', 70), ev('c', 140), ev('d', 210), ev('e', 280)], 290, {
      goals: { maxStandardDrinksPerSession: 2, paceGoalMinutesBetweenDrinks: null },
      frequency: 'frequent',
    }));
    const keys = [r.decision.deliver, ...r.decision.deferred.map((d) => d.candidate)].map((c) => c?.messageKey);
    expect(keys).toContain('closure.consider_ending');
  });

  it('pace-goal reminders reference the actual interval, never a countdown', () => {
    const r = evaluateInterventions(ctx([ev('a', 5, 0.5), ev('b', 25, 0.5)], 26, { goals: { maxStandardDrinksPerSession: null, paceGoalMinutesBetweenDrinks: 45 } }));
    expect(r.decision.deliver?.messageKey).toBe('goal.pace');
    expect(r.decision.deliver?.body).not.toMatch(/\d+\s*min/);
  });

  it('produces safe on-screen recommendations', () => {
    const pace = new PaceTracker(start, undefined, [ev('a', 5), ev('b', 12), ev('c', 20)]).snapshot(start + 22 * MINUTE_MS);
    for (const goal of [null, 2, 3, 5]) {
      const text = sessionRecommendation(pace, { maxStandardDrinksPerSession: goal, paceGoalMinutesBetweenDrinks: null }, US);
      expect(isSafeMessage(text)).toBe(true);
    }
  });
});
