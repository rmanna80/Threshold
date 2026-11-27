import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  enumerateDays,
  evaluateGoal,
  formatDuration,
  legalDrinkingAge,
  localDateKey,
  parseBeverageLabel,
  startOfWeek,
  validateGoals,
  weekdayIndex,
  HOUR_MS,
} from '../src';

describe('time handling', () => {
  it('attributes local dates using the captured offset, not the device zone', () => {
    const at = Date.UTC(2026, 10, 27, 3, 30); // 03:30 UTC
    expect(localDateKey(at, -300)).toBe('2026-11-26'); // 22:30 in New York
    expect(localDateKey(at, 60)).toBe('2026-11-27'); // 04:30 in Paris
  });

  it('supports a day boundary for late nights', () => {
    const at = Date.UTC(2026, 10, 27, 6, 0); // 01:00 New York on the 27th
    expect(localDateKey(at, -300, 0)).toBe('2026-11-27');
    expect(localDateKey(at, -300, 5)).toBe('2026-11-26');
  });

  it('is stable across a DST change because offsets are stored per event', () => {
    const beforeDst = Date.UTC(2026, 2, 8, 6, 30); // 01:30 EST (-300)
    const afterDst = Date.UTC(2026, 2, 8, 7, 30); // 03:30 EDT (-240)
    expect(localDateKey(beforeDst, -300)).toBe('2026-03-08');
    expect(localDateKey(afterDst, -240)).toBe('2026-03-08');
  });

  it('handles calendar arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(29);
    expect(enumerateDays('2026-11-28', '2026-12-01')).toEqual(['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
    expect(weekdayIndex('2026-11-30')).toBe(0); // Monday
    expect(startOfWeek('2026-11-26')).toBe('2026-11-23');
  });

  it('formats durations', () => {
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(2 * HOUR_MS)).toBe('2 h 00 min');
  });
});

describe('label parsing', () => {
  it('extracts ABV, serving and a name candidate', () => {
    const parsed = parseBeverageLabel(['NORTHWIND', 'Pale Ale', 'ALC. 5.6% BY VOL.', '12 FL. OZ.', 'GOVERNMENT WARNING: ...']);
    expect(parsed.abvPercent?.value).toBe(5.6);
    expect(parsed.abvPercent?.confidence).toBe('high');
    expect(parsed.serving?.value).toEqual({ value: 12, unit: 'fl_oz_us' });
    expect(parsed.productName?.value).toBe('NORTHWIND');
  });

  it('understands proof and metric volumes', () => {
    const parsed = parseBeverageLabel(['Kentucky Straight Bourbon', '90 PROOF', '750 mL']);
    expect(parsed.abvPercent?.value).toBe(45);
    expect(parsed.serving?.value).toEqual({ value: 750, unit: 'ml' });
  });

  it('prefers alcohol-context percentages over unrelated ones', () => {
    const parsed = parseBeverageLabel(['100% natural ingredients', '13,5% vol', '75 cl']);
    expect(parsed.abvPercent?.value).toBe(13.5);
    expect(parsed.serving?.value).toEqual({ value: 75, unit: 'cl' });
  });

  it('returns nulls rather than guesses when nothing is recognisable', () => {
    const parsed = parseBeverageLabel(['', '  ']);
    expect(parsed.abvPercent).toBeNull();
    expect(parsed.serving).toBeNull();
    expect(parsed.productName).toBeNull();
  });
});

describe('goals', () => {
  it('reports recorded vs goal without an allowance', () => {
    expect(evaluateGoal(2, 4)).toMatchObject({ status: 'below_goal', ratio: 0.5 });
    expect(evaluateGoal(4, 4).status).toBe('at_goal');
    expect(evaluateGoal(5, 4).status).toBe('above_goal');
    expect(evaluateGoal(1, null).status).toBe('no_goal');
    expect(evaluateGoal(0, 0).status).toBe('at_goal');
    expect(evaluateGoal(0.5, 0).status).toBe('above_goal');
    expect(Object.keys(evaluateGoal(2, 4))).not.toContain('remaining');
  });

  it('validates goal ranges', () => {
    expect(validateGoals({ alcoholFreeDaysPerWeek: 8 })).toHaveLength(1);
    expect(validateGoals({ paceGoalMinutesBetweenDrinks: 5 })).toHaveLength(1);
    expect(validateGoals({ maxStandardDrinksPerSession: 3 })).toHaveLength(0);
  });
});

describe('eligibility', () => {
  it('uses conservative legal ages with an 18 floor', () => {
    expect(legalDrinkingAge('US')).toBe(21);
    expect(legalDrinkingAge('gb')).toBe(18);
    expect(legalDrinkingAge('ZZ')).toBe(18);
  });
});
