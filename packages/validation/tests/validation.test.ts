import { describe, expect, it } from 'vitest';
import { drinkEventSchema, parseSyncEnvelope, parseWith, recoveryCheckinSchema, userGoalsSchema } from '../src';

const drink = {
  id: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  beverageId: null,
  beverageName: 'Beer',
  category: 'beer',
  servingInput: { value: 12, unit: 'fl_oz_us' },
  servingMl: 354.88,
  fractionConsumed: 1,
  abvPercent: 5,
  ethanolGrams: 14,
  standardDrinks: 1,
  standardDrinkGrams: 14,
  isAlcoholic: true,
  consumedAt: 1_700_000_000_000,
  loggedAt: 1_700_000_000_000,
  tzOffsetMin: -300,
  source: 'manual',
  confirmation: 'user_confirmed',
  uncertainty: { abvKnown: true, volumeKnown: true, standardDrinksLow: null, standardDrinksHigh: null, note: null },
  revision: 1,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
  deviceId: 'phone-1',
};

describe('validation', () => {
  it('accepts a valid drink event', () => {
    expect(parseWith(drinkEventSchema, drink).ok).toBe(true);
  });

  it('rejects inconsistent or out-of-range drink events', () => {
    expect(parseWith(drinkEventSchema, { ...drink, fractionConsumed: 0 }).ok).toBe(false);
    expect(parseWith(drinkEventSchema, { ...drink, abvPercent: 120 }).ok).toBe(false);
    expect(parseWith(drinkEventSchema, { ...drink, standardDrinks: null }).ok).toBe(false);
    expect(parseWith(drinkEventSchema, { ...drink, id: 'not-a-uuid' }).ok).toBe(false);
  });

  it('validates goals and check-ins', () => {
    expect(parseWith(userGoalsSchema, { objectives: ['reduce_frequency'], maxStandardDrinksPerSession: 3, maxStandardDrinksPerWeek: null, alcoholFreeDaysPerWeek: 3, paceGoalMinutesBetweenDrinks: null, updatedAt: 1 }).ok).toBe(true);
    expect(parseWith(recoveryCheckinSchema, { id: drink.id, sessionId: null, localDate: '2026-11-27', completedAt: 1, headache: 11, fatigue: null, nausea: null, dizziness: null, sleepQuality: null, mentalClarity: null, overallSeverity: null, functionalImpairment: null, ateBeforeDrinking: null, hydrationReported: null, revision: 1, updatedAt: 1, deletedAt: null }).ok).toBe(false);
  });

  it('validates sync envelopes including payload/entity consistency', () => {
    const env = { idempotencyKey: 'drink_event:abc:1', entityType: 'drink_event', entityId: drink.id, op: 'upsert', revision: 1, clientUpdatedAt: 1, deviceId: 'phone-1', payload: drink };
    expect(parseSyncEnvelope(env).ok).toBe(true);
    expect(parseSyncEnvelope({ ...env, entityId: '00000000-0000-4000-8000-000000000009' }).ok).toBe(false);
    expect(parseSyncEnvelope({ ...env, payload: { ...drink, servingMl: -1 } }).ok).toBe(false);
    expect(parseSyncEnvelope({ ...env, op: 'delete', payload: null }).ok).toBe(true);
  });
});
