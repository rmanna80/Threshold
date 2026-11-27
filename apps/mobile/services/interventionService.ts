import {
  computePace,
  countsTowardConsumption,
  evaluateInterventions,
  localDateKey,
  startOfWeek,
  addDays,
  DAY_MS,
  type InterventionContext,
  type PhysiologyContext,
} from '@threshold/core';
import type { DrinkEvent, InterventionEvent, UserGoals, UserPreferences } from '@threshold/shared-types';
import type { Repositories } from '../database/repositories';
import { definitionFor } from '../lib/format';
import type { Clock } from './clock';
import type { NotificationGateway } from './notifications';
import type { SessionChange } from './sessionService';

export type InterventionListener = (sessionId: string, events: InterventionEvent[], delivered: InterventionEvent | null) => void;

export interface InterventionServiceDeps {
  repos: Repositories;
  clock: Clock;
  notifications: NotificationGateway;
  getPreferences: () => UserPreferences | null;
  getGoals: () => UserGoals | null;
  /** Physiology context (Phase 4 baseline service). Must only report real, timestamped readings. */
  getPhysiology: (sessionId: string) => Promise<PhysiologyContext | null>;
  haptic?: () => void;
}

const TRIGGER_REASONS: ReadonlySet<SessionChange['reason']> = new Set(['drink_added', 'drink_edited', 'drink_deleted', 'remote_update', 'resumed']);

/** Counts alcoholic drinks logged since the most recent non-alcoholic drink (water, mocktail…). */
export function alcoholicSinceLastNonAlcoholic(drinks: readonly DrinkEvent[]): number {
  const sorted = drinks.filter((d) => d.deletedAt === null).sort((a, b) => a.consumedAt - b.consumedAt);
  let count = 0;
  for (const d of sorted) {
    if (!d.isAlcoholic) count = 0;
    else if (countsTowardConsumption(d)) count += 1;
  }
  return count;
}

export class InterventionService {
  private listeners = new Set<InterventionListener>();

  constructor(private readonly deps: InterventionServiceDeps) {}

  subscribe(l: InterventionListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async buildContext(change: SessionChange): Promise<InterventionContext> {
    const { repos, clock } = this.deps;
    const prefs = this.deps.getPreferences();
    const goals = this.deps.getGoals();
    const now = clock.now();
    const def = definitionFor(prefs ?? { standardDrinkRegion: 'US', customStandardDrinkGrams: null });
    const drinks = change.drinks.filter((d) => d.deletedAt === null);
    const alcoholic = drinks.filter(countsTowardConsumption).sort((a, b) => a.consumedAt - b.consumedAt);
    const last = alcoholic[alcoholic.length - 1];
    const prev = alcoholic[alcoholic.length - 2];

    let weekly: InterventionContext['weekly'] = null;
    if (goals?.maxStandardDrinksPerWeek !== null && goals?.maxStandardDrinksPerWeek !== undefined) {
      const boundary = prefs?.dayBoundaryHour ?? 5;
      const todayKey = localDateKey(now, clock.tzOffsetMin(now), boundary);
      const weekKey = startOfWeek(todayKey);
      const weekDrinks = await repos.drinks.listBetween(now - 8 * DAY_MS, now + DAY_MS);
      const recordedBeforeSession = weekDrinks
        .filter((d) => d.sessionId !== change.session.id && countsTowardConsumption(d))
        .filter((d) => {
          const k = localDateKey(d.consumedAt, d.tzOffsetMin, boundary);
          return k >= weekKey && k <= addDays(weekKey, 6);
        })
        .reduce((s, d) => s + (d.standardDrinks ?? 0), 0);
      weekly = { goal: goals.maxStandardDrinksPerWeek, recordedBeforeSession, weekKey };
    }

    return {
      now,
      sessionId: change.session.id,
      sessionStartedAt: change.session.startedAt,
      pace: computePace(change.session.startedAt, drinks, now),
      goals: change.session.goalSnapshot,
      weekly,
      objectives: goals?.objectives ?? [],
      frequency: prefs?.notificationFrequency ?? 'standard',
      quietMode: prefs?.quietMode ?? false,
      definition: def,
      alcoholicSinceLastNonAlcoholic: alcoholicSinceLastNonAlcoholic(drinks),
      lastIntervalMs: last && prev ? last.consumedAt - prev.consumedAt : null,
      lastDrinkId: last?.id ?? null,
      physiology: await this.deps.getPhysiology(change.session.id),
      history: await repos.interventions.listForSession(change.session.id),
    };
  }

  /** Evaluate after a session change; persists every decision and delivers at most one prompt. */
  async onSessionChange(change: SessionChange): Promise<InterventionEvent[]> {
    if (change.session.status === 'ended' || !TRIGGER_REASONS.has(change.reason)) return [];
    const ctx = await this.buildContext(change);
    const { events } = evaluateInterventions(ctx);
    // Drinks logged on the watch are evaluated and announced by the watch's own engine; the phone
    // records the decision for history and dedupe but does not notify a second time.
    const remote = change.reason === 'remote_update';
    const final = events.map((e) => (remote && e.delivered ? { ...e, delivered: false, suppressedReason: 'delivered_on_watch' } : e));
    for (const e of final) await this.deps.repos.interventions.insert(e);
    const delivered = final.find((e) => e.delivered) ?? null;
    if (delivered) {
      await this.deps.notifications.present({ title: delivered.title, body: delivered.body, data: { sessionId: delivered.sessionId, interventionId: delivered.id } });
      this.deps.haptic?.();
    }
    for (const l of this.listeners) l(change.session.id, final, delivered);
    return final;
  }

  async acknowledge(id: string, dismissed: boolean): Promise<void> {
    await this.deps.repos.interventions.acknowledge(id, this.deps.clock.now(), dismissed);
  }
}
