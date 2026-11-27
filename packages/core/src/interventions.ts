import type {
  EpochMs,
  InterventionCategory,
  InterventionEvent,
  InterventionPriority,
  ModerationObjective,
  NotificationFrequency,
  SessionGoalSnapshot,
  StandardDrinkDefinition,
} from '@threshold/shared-types';
import { newId } from './ids';
import type { PaceSnapshot } from './pace';
import { assertSafeMessage } from './safety';
import { HOUR_MS, MINUTE_MS, formatAge } from './time';
import { roundTo } from './units';

/**
 * Intervention engine: rules propose candidates from the current session state; a policy
 * applies deduplication, quiet mode, frequency preferences, fatigue-aware rate limits and
 * priority. Deterministic for a given input (ids aside), so it is fully unit-testable.
 *
 * Personal goals are always described as the user's own goals, never as safety thresholds.
 */

export interface PhysiologyContext {
  /** Most recent heart-rate deviation assessment vs. the user's resting baseline. */
  heartRate: {
    direction: 'elevated' | 'typical' | 'lower';
    measuredAt: EpochMs;
    baselineMature: boolean;
    measurementId: string;
  } | null;
}

export interface InterventionContext {
  now: EpochMs;
  sessionId: string;
  sessionStartedAt: EpochMs;
  pace: PaceSnapshot;
  goals: SessionGoalSnapshot;
  weekly: { goal: number | null; recordedBeforeSession: number; weekKey: string } | null;
  objectives: readonly ModerationObjective[];
  frequency: NotificationFrequency;
  quietMode: boolean;
  definition: StandardDrinkDefinition;
  /** Alcoholic drinks logged since the most recent water/non-alcoholic drink in this session. */
  alcoholicSinceLastNonAlcoholic: number;
  /** Interval between the last two alcoholic drinks, if any. */
  lastIntervalMs: number | null;
  lastDrinkId: string | null;
  physiology: PhysiologyContext | null;
  /** Previously recorded interventions for this session (delivered or suppressed). */
  history: readonly InterventionEvent[];
}

export interface InterventionCandidate {
  category: InterventionCategory;
  priority: InterventionPriority;
  messageKey: string;
  dedupeKey: string;
  title: string;
  body: string;
}

export interface PolicyConfig {
  minGapMs: number;
  categoryCooldownMs: number;
  maxPerSession: number;
  maxPriority: InterventionPriority;
}

export const FREQUENCY_POLICIES: Readonly<Record<NotificationFrequency, PolicyConfig>> = Object.freeze({
  minimal: { minGapMs: 30 * MINUTE_MS, categoryCooldownMs: 45 * MINUTE_MS, maxPerSession: 4, maxPriority: 1 },
  standard: { minGapMs: 15 * MINUTE_MS, categoryCooldownMs: 25 * MINUTE_MS, maxPerSession: 8, maxPriority: 2 },
  frequent: { minGapMs: 10 * MINUTE_MS, categoryCooldownMs: 15 * MINUTE_MS, maxPerSession: 12, maxPriority: 3 },
});

const CATEGORY_ORDER: readonly InterventionCategory[] = [
  'personal_goal',
  'consumption_pace',
  'session_closure',
  'nonalcoholic_alternative',
  'physiological_change',
  'recovery_awareness',
];

// ---------------------------------------------------------------------------
// Message catalogue — every entry is checked by the safety guard (see tests).
// ---------------------------------------------------------------------------

export const MESSAGE_CATALOG = Object.freeze({
  'pace.rapid': {
    title: 'Pace check',
    body: 'You’ve recorded several drinks in a short period. Consider taking a break from alcohol.',
  },
  'pace.concentrated': {
    title: 'Pace check',
    body: 'Your drinks are becoming more concentrated in time. Consider pausing alcohol for a while.',
  },
  'goal.session_reached': {
    title: 'Your goal for tonight',
    body: 'You’ve reached the moderation goal you set before this session.',
  },
  'goal.session_above': {
    title: 'Your goal for tonight',
    body: 'You’re now above the goal you set for this session. Consider switching to water or a non-alcoholic drink.',
  },
  'goal.pace': {
    title: 'Your pacing goal',
    body: 'Your last two drinks were closer together than the pacing goal you set.',
  },
  'goal.weekly_reached': {
    title: 'Your weekly goal',
    body: 'With tonight’s drinks you’ve reached the weekly goal you set.',
  },
  'alternative.switch': {
    title: 'A change of glass',
    body: 'Consider switching to water or a non-alcoholic beverage.',
  },
  'physiology.hr_elevated': {
    title: 'Heart rate note',
    body: 'Your most recent heart rate reading ({age}) is higher than your typical resting range. Many things raise heart rate, including activity, caffeine, stress, heat or illness.',
  },
  'recovery.awareness': {
    title: 'Thinking about tomorrow',
    body: 'Your recent consumption pattern may contribute to poorer sleep and next-day recovery.',
  },
  'closure.consider_ending': {
    title: 'Winding down',
    body: 'Consider ending alcohol consumption for the evening.',
  },
} as const);

export type MessageKey = keyof typeof MESSAGE_CATALOG;

function candidate(
  category: InterventionCategory,
  priority: InterventionPriority,
  key: MessageKey,
  dedupeKey: string,
  vars: Record<string, string> = {},
): InterventionCandidate {
  const entry = MESSAGE_CATALOG[key];
  const body = entry.body.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  return { category, priority, messageKey: key, dedupeKey, title: entry.title, body: assertSafeMessage(body) };
}

const EPS = 1e-9;

/** Rules: propose every applicable intervention for the current state. */
export function proposeInterventions(ctx: InterventionContext): InterventionCandidate[] {
  const out: InterventionCandidate[] = [];
  const p = ctx.pace;
  const total = p.totalStandardDrinks;

  // Consumption pace — keyed to the number of drinks so a new trigger needs new drinks.
  if (p.rapidConsumption) {
    out.push(candidate('consumption_pace', 1, 'pace.rapid', `pace:rapid:${p.totalDrinks}`));
  } else if (p.concentrated && p.concentrationRising) {
    out.push(candidate('consumption_pace', 2, 'pace.concentrated', `pace:concentrated:${p.totalDrinks}`));
  }

  // Personal session goal.
  const g = ctx.goals.maxStandardDrinksPerSession;
  if (g !== null && g > 0) {
    if (total > g + EPS) out.push(candidate('personal_goal', 1, 'goal.session_above', 'goal:session:above'));
    else if (total + EPS >= g) out.push(candidate('personal_goal', 1, 'goal.session_reached', 'goal:session:reached'));
  }
  // Personal pacing goal (only after an actual interval; never phrased as a countdown).
  const paceGoal = ctx.goals.paceGoalMinutesBetweenDrinks;
  if (paceGoal !== null && ctx.lastIntervalMs !== null && ctx.lastDrinkId && ctx.lastIntervalMs < paceGoal * MINUTE_MS) {
    out.push(candidate('personal_goal', 2, 'goal.pace', `goal:pace:${ctx.lastDrinkId}`));
  }
  // Weekly goal.
  if (ctx.weekly && ctx.weekly.goal !== null && ctx.weekly.goal > 0 && ctx.weekly.recordedBeforeSession + total + EPS >= ctx.weekly.goal) {
    out.push(candidate('personal_goal', 2, 'goal.weekly_reached', `goal:weekly:${ctx.weekly.weekKey}`));
  }

  // Non-alcoholic alternatives every second consecutive alcoholic drink.
  if (ctx.alcoholicSinceLastNonAlcoholic >= 2) {
    const bucket = Math.floor(ctx.alcoholicSinceLastNonAlcoholic / 2);
    out.push(candidate('nonalcoholic_alternative', 2, 'alternative.switch', `alt:${p.totalDrinks - ctx.alcoholicSinceLastNonAlcoholic}:${bucket}`));
  }

  // Physiology — descriptive only; requires a mature baseline and a fresh (≤ 20 min) reading.
  const hr = ctx.physiology?.heartRate;
  if (hr && hr.direction === 'elevated' && hr.baselineMature && ctx.now - hr.measuredAt <= 20 * MINUTE_MS) {
    out.push(
      candidate('physiological_change', 3, 'physiology.hr_elevated', `physio:hr:${hr.measurementId}`, {
        age: formatAge(hr.measuredAt, ctx.now),
      }),
    );
  }

  // Recovery awareness — once per session, for users who care about recovery/sleep.
  const caresAboutRecovery = ctx.objectives.some((o) => o === 'improve_recovery' || o === 'understand_sleep' || o === 'athletic_recovery');
  if (caresAboutRecovery && (p.concentrated || p.maxStandardDrinksInAny60Min + EPS >= 3)) {
    out.push(candidate('recovery_awareness', 3, 'recovery.awareness', 'recovery:session'));
  }

  // Session closure — long sessions still accumulating drinks, or above the personal goal.
  const longAndActive = ctx.now - ctx.sessionStartedAt >= 4 * HOUR_MS && p.timeSinceLastDrinkMs !== null && p.timeSinceLastDrinkMs < HOUR_MS;
  const aboveGoal = g !== null && total > g + 1 + EPS;
  if (longAndActive || aboveGoal) {
    out.push(candidate('session_closure', 2, 'closure.consider_ending', 'closure:session'));
  }

  return out;
}

export interface PolicyDecision {
  deliver: InterventionCandidate | null;
  /** Candidates permanently recorded as suppressed (quiet mode / frequency preference). */
  suppressed: { candidate: InterventionCandidate; reason: 'quiet_mode' | 'frequency_preference' | 'session_cap' }[];
  /** Candidates postponed by rate limits; they may fire on a later evaluation. */
  deferred: { candidate: InterventionCandidate; reason: 'min_gap' | 'category_cooldown' | 'one_per_evaluation' }[];
}

/** Policy: dedupe → quiet mode → frequency filter → caps → fatigue-aware rate limits → priority. */
export function applyPolicy(ctx: InterventionContext, candidates: readonly InterventionCandidate[]): PolicyDecision {
  const config = FREQUENCY_POLICIES[ctx.frequency];
  const seen = new Set(ctx.history.map((h) => h.dedupeKey));
  const delivered = ctx.history.filter((h) => h.delivered).sort((a, b) => a.triggeredAt - b.triggeredAt);
  const lastDelivered = delivered[delivered.length - 1];

  // Fatigue: if the user dismissed at least 2 of the last 3 delivered prompts, double the gap.
  const recent = delivered.slice(-3);
  const fatigue = recent.length >= 2 && recent.filter((d) => d.dismissed).length >= 2;
  const minGap = config.minGapMs * (fatigue ? 2 : 1);

  const decision: PolicyDecision = { deliver: null, suppressed: [], deferred: [] };
  const fresh = candidates
    .filter((c) => !seen.has(c.dedupeKey))
    .filter((c, i, arr) => arr.findIndex((x) => x.dedupeKey === c.dedupeKey) === i)
    .sort((a, b) => a.priority - b.priority || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  for (const c of fresh) {
    if (ctx.quietMode && c.category !== 'personal_goal') {
      decision.suppressed.push({ candidate: c, reason: 'quiet_mode' });
      continue;
    }
    if (c.priority > config.maxPriority) {
      decision.suppressed.push({ candidate: c, reason: 'frequency_preference' });
      continue;
    }
    if (delivered.length >= config.maxPerSession) {
      decision.suppressed.push({ candidate: c, reason: 'session_cap' });
      continue;
    }
    if (decision.deliver) {
      decision.deferred.push({ candidate: c, reason: 'one_per_evaluation' });
      continue;
    }
    // Priority-1 personal-goal messages bypass the global gap (the user asked for them).
    const bypassGap = c.category === 'personal_goal' && c.priority === 1;
    if (!bypassGap && lastDelivered && ctx.now - lastDelivered.triggeredAt < minGap) {
      decision.deferred.push({ candidate: c, reason: 'min_gap' });
      continue;
    }
    const lastSameCategory = [...delivered].reverse().find((d) => d.category === c.category);
    if (!bypassGap && lastSameCategory && ctx.now - lastSameCategory.triggeredAt < config.categoryCooldownMs) {
      decision.deferred.push({ candidate: c, reason: 'category_cooldown' });
      continue;
    }
    decision.deliver = c;
  }
  return decision;
}

/** Turn a policy decision into records to persist. */
export function toInterventionEvents(ctx: InterventionContext, decision: PolicyDecision): InterventionEvent[] {
  const events: InterventionEvent[] = [];
  const make = (c: InterventionCandidate, delivered: boolean, reason: string | null): InterventionEvent => ({
    id: newId(),
    sessionId: ctx.sessionId,
    category: c.category,
    messageKey: c.messageKey,
    title: c.title,
    body: c.body,
    priority: c.priority,
    dedupeKey: c.dedupeKey,
    triggeredAt: ctx.now,
    delivered,
    suppressedReason: reason,
    acknowledgedAt: null,
    dismissed: false,
  });
  if (decision.deliver) events.push(make(decision.deliver, true, null));
  for (const s of decision.suppressed) events.push(make(s.candidate, false, s.reason));
  return events;
}

export function evaluateInterventions(ctx: InterventionContext): { decision: PolicyDecision; events: InterventionEvent[] } {
  const decision = applyPolicy(ctx, proposeInterventions(ctx));
  return { decision, events: toInterventionEvents(ctx, decision) };
}

/** On-screen recommendation for the active session dashboard (no notification). */
export function sessionRecommendation(pace: PaceSnapshot, goals: SessionGoalSnapshot, def: StandardDrinkDefinition): string {
  const g = goals.maxStandardDrinksPerSession;
  if (g !== null && pace.totalStandardDrinks > g + EPS) {
    return assertSafeMessage(`You’re above your goal of ${roundTo(g, 1)} ${g === 1 ? def.label : def.labelPlural}. Consider ending alcohol for tonight.`);
  }
  if (pace.rapidConsumption) return assertSafeMessage(MESSAGE_CATALOG['pace.rapid'].body);
  if (g !== null && pace.totalStandardDrinks + EPS >= g) return assertSafeMessage(MESSAGE_CATALOG['goal.session_reached'].body);
  if (pace.totalDrinks === 0) return assertSafeMessage('Log drinks as you go — one tap is enough.');
  return assertSafeMessage('Alternating with water or a non-alcoholic drink can help you pace your evening.');
}
