import { beforeEach, describe, expect, it } from 'vitest';
import type { DrinkEvent, DrinkingSession } from '@threshold/shared-types';
import {
  associate,
  buildDrinkEvent,
  calendarHeatmap,
  compareVersions,
  createSession,
  csvCell,
  dailyTotals,
  endSession,
  goalAdherence,
  intervalDistribution,
  monthlySeries,
  resolveConflict,
  resolveStandardDrinkDefinition,
  sequentialIdGenerator,
  setIdGenerator,
  spearman,
  summarizePeriod,
  summarizeSession,
  toCsv,
  weeklySeries,
  buildExportBundle,
} from '../src';
import { MINUTE_MS } from '../src/time';

const US = resolveStandardDrinkDefinition('US');
beforeEach(() => setIdGenerator(sequentialIdGenerator()));

function makeSession(startUtc: number): DrinkingSession {
  return createSession({ now: startUtc, tzOffsetMin: -300, deviceId: 'p', origin: 'phone', goals: { maxStandardDrinksPerSession: 2, paceGoalMinutesBetweenDrinks: null } });
}
function drink(sessionId: string, at: number, abv: number | null = 5): DrinkEvent {
  const r = buildDrinkEvent({
    sessionId,
    beverage: { id: null, name: 'Beer', category: 'beer' },
    measurement: { serving: { value: 12, unit: 'fl_oz_us' }, abvPercent: abv, fractionConsumed: 1, definition: US },
    consumedAt: at,
    loggedAt: at,
    tzOffsetMin: -300,
    source: 'manual',
    deviceId: 'p',
  });
  if (!r.ok) throw new Error('bad drink');
  return r.value;
}

describe('daily and period aggregation', () => {
  // Friday 27 Nov 2026, 22:00 New York = 28 Nov 03:00 UTC
  const fri = Date.UTC(2026, 10, 28, 3);
  const s = makeSession(fri);
  const drinks = [drink(s.id, fri), drink(s.id, fri + 90 * MINUTE_MS), drink(s.id, fri + 3 * 60 * MINUTE_MS, null)];

  it('attributes late-night drinks to the evening with a day boundary', () => {
    const totals = dailyTotals(drinks, 5);
    expect([...totals.keys()]).toEqual(['2026-11-27']);
    const day = totals.get('2026-11-27')!;
    expect(day.drinks).toBe(3);
    expect(day.unknownStrength).toBe(1);
    expect(day.standardDrinks).toBeCloseTo(2.000016, 5);
  });

  it('counts alcohol-free days only up to today', () => {
    const totals = dailyTotals(drinks, 5);
    const week = summarizePeriod(totals, '2026-11-23', '2026-11-29', '2026-11-28');
    expect(week.elapsedDays).toBe(6);
    expect(week.drinkingDays).toBe(1);
    expect(week.alcoholFreeDays).toBe(5);
    const series = weeklySeries(totals, '2026-11-28', 3);
    expect(series.map((w) => w.from)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
    expect(monthlySeries(totals, '2026-11-28', 2).map((m) => m.from)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('builds a fixed-bucket heatmap (not relative to the user)', () => {
    const cells = calendarHeatmap(dailyTotals(drinks, 5), '2026-11-26', '2026-11-29', '2026-11-28');
    expect(cells.map((c) => c.level)).toEqual([0, 3, 0, 0]);
    expect(cells[3]?.future).toBe(true);
  });

  it('summarises a session including pace peaks and goal status', () => {
    const ended = endSession(s, fri + 4 * 60 * MINUTE_MS, 'p');
    if (!ended.ok) throw new Error();
    const sum = summarizeSession(ended.value, drinks, fri + 5 * 60 * MINUTE_MS, 5);
    expect(sum.drinks).toBe(3);
    expect(sum.goalMet).toBe(false);
    expect(sum.meanIntervalMin).toBeCloseTo(90, 9);
    expect(sum.localDate).toBe('2026-11-27');
    const hist = intervalDistribution([ended.value], drinks);
    expect(hist.find((b) => b.min === 90)?.count).toBe(2);
  });

  it('evaluates goal adherence without praising consumption', () => {
    const totals = dailyTotals(drinks, 5);
    const weeks = weeklySeries(totals, '2026-11-28', 1);
    const [w] = goalAdherence(weeks, { alcoholFreeDaysPerWeek: 4, maxStandardDrinksPerWeek: 1 });
    expect(w?.alcoholFreeGoalMet).toBe(true);
    expect(w?.weeklyGoalMet).toBe(false);
  });
});

describe('associations', () => {
  it('refuses to compute with too little data', () => {
    expect(associate([{ exposure: 1, outcome: 2 }]).status).toBe('insufficient_data');
  });

  it('computes median-split means and Spearman rho', () => {
    const pairs = Array.from({ length: 12 }, (_, i) => ({ exposure: i, outcome: 10 - i * 0.5 }));
    const r = associate(pairs);
    expect(r.status).toBe('computed');
    expect(r.lowerGroup!.meanOutcome).toBeGreaterThan(r.higherGroup!.meanOutcome);
    expect(r.spearmanRho).toBeCloseTo(-1, 9);
    expect(spearman([1, 2, 3], [1, 1, 1])).toBeNull();
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9486832980505138, 9);
  });
});

describe('export and sync helpers', () => {
  it('escapes CSV and blocks formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(toCsv([{ a: 1, b: 'x' }], ['a', 'b'])).toBe('a,b\r\n1,x\r\n');
    expect(buildExportBundle({}, 0, '0.1.0').schemaVersion).toBe(1);
  });

  it('resolves conflicts deterministically', () => {
    const a = { revision: 2, updatedAt: 10, deviceId: 'a' };
    const b = { revision: 2, updatedAt: 10, deviceId: 'b' };
    expect(compareVersions(a, b)).toBeLessThan(0);
    expect(resolveConflict(a, b).source).toBe('remote');
    expect(resolveConflict({ ...a, revision: 3 }, b).source).toBe('local');
    expect(resolveConflict(null, b).source).toBe('remote');
    expect(resolveConflict(a, { ...a }).source).toBe('equal');
  });
});
