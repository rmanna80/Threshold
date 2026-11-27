import {
  DAY_MS,
  addDays,
  associate,
  calendarHeatmap,
  dailyTotals,
  goalAdherence,
  intervalDistribution,
  localDateKey,
  monthlySeries,
  pairSessionsWithCheckins,
  paceDistribution,
  startOfWeek,
  summarizeSession,
  weeklySeries,
  type AssociationResult,
  type GoalAdherenceWeek,
  type HeatmapCell,
  type HistogramBin,
  type PeriodSummary,
  type SessionSummary,
} from '@threshold/core';
import type { LocalDateKey, RecoveryCheckin, UserGoals, UserPreferences } from '@threshold/shared-types';
import type { AppServices } from './container';

export interface AnalyticsView {
  today: LocalDateKey;
  weeks: PeriodSummary[];
  months: PeriodSummary[];
  currentWeek: PeriodSummary;
  heatmap: HeatmapCell[];
  sessions: SessionSummary[];
  paceHistogram: HistogramBin[];
  intervalHistogram: HistogramBin[];
  adherence: GoalAdherenceWeek[];
  checkins: RecoveryCheckin[];
  sleepVsPeakPace: AssociationResult;
  severityVsTotal: AssociationResult;
  estimatedDrinks: number;
  unknownStrengthDrinks: number;
  last7Days: { date: LocalDateKey; standardDrinks: number; drank: boolean }[];
}

export async function loadAnalytics(
  services: Pick<AppServices, 'repos' | 'clock'>,
  prefs: Pick<UserPreferences, 'dayBoundaryHour'>,
  goals: Pick<UserGoals, 'alcoholFreeDaysPerWeek' | 'maxStandardDrinksPerWeek'>,
  weekCount: number,
): Promise<AnalyticsView> {
  const { repos, clock } = services;
  const now = clock.now();
  const boundary = prefs.dayBoundaryHour;
  const today = localDateKey(now, clock.tzOffsetMin(now), boundary);
  const horizonMs = now - Math.max(weekCount * 7, 190) * DAY_MS;
  const [drinks, sessions, checkins] = await Promise.all([
    repos.drinks.listBetween(horizonMs, now + DAY_MS),
    repos.sessions.listBetween(horizonMs - DAY_MS, now + DAY_MS),
    repos.checkins.listRecent(400),
  ]);
  const totals = dailyTotals(drinks, boundary);
  const weeks = weeklySeries(totals, today, weekCount);
  const summaries = sessions.map((s) => summarizeSession(s, drinks, now, boundary)).sort((a, b) => b.startedAt - a.startedAt);
  const heatStart = startOfWeek(addDays(today, -7 * (Math.min(weekCount, 26) - 1)));
  const heatEnd = addDays(startOfWeek(today), 6);
  return {
    today,
    weeks,
    months: monthlySeries(totals, today, 6),
    currentWeek: weeks[weeks.length - 1] as PeriodSummary,
    heatmap: calendarHeatmap(totals, heatStart, heatEnd, today),
    sessions: summaries,
    paceHistogram: paceDistribution(summaries),
    intervalHistogram: intervalDistribution(sessions, drinks),
    adherence: goalAdherence(weeks, goals),
    checkins,
    sleepVsPeakPace: associate(pairSessionsWithCheckins(summaries, checkins, (s) => s.peakStandardDrinksIn60Min, (c) => c.sleepQuality)),
    severityVsTotal: associate(pairSessionsWithCheckins(summaries, checkins, (s) => s.standardDrinks, (c) => c.overallSeverity)),
    estimatedDrinks: drinks.filter((d) => d.confirmation === 'estimated' && d.isAlcoholic).length,
    unknownStrengthDrinks: drinks.filter((d) => d.isAlcoholic && d.standardDrinks === null).length,
    last7Days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i - 6);
      const t = totals.get(date);
      return { date, standardDrinks: t?.standardDrinks ?? 0, drank: (t?.drinks ?? 0) > 0 };
    }),
  };
}
