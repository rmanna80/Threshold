import type { UserGoals, ValidationIssue } from '@threshold/shared-types';

/**
 * Personal goals are user choices, not safety thresholds. Progress is expressed as
 * "recorded vs. your goal" — Threshold never computes or displays a remaining allowance.
 */
export type GoalStatus = 'no_goal' | 'below_goal' | 'at_goal' | 'above_goal';

export interface GoalProgress {
  status: GoalStatus;
  recorded: number;
  goal: number | null;
  /** recorded / goal, for progress visuals; null without a goal. */
  ratio: number | null;
}

const EPS = 1e-9;

export function evaluateGoal(recorded: number, goal: number | null): GoalProgress {
  if (goal === null || !Number.isFinite(goal) || goal < 0) {
    return { status: 'no_goal', recorded, goal: null, ratio: null };
  }
  if (goal === 0) {
    return { status: recorded > EPS ? 'above_goal' : 'at_goal', recorded, goal, ratio: recorded > EPS ? Infinity : 1 };
  }
  const ratio = recorded / goal;
  const status: GoalStatus = recorded > goal + EPS ? 'above_goal' : Math.abs(recorded - goal) <= EPS ? 'at_goal' : 'below_goal';
  return { status, recorded, goal, ratio };
}

export function validateGoals(goals: Partial<UserGoals>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const check = (field: keyof UserGoals, min: number, max: number) => {
    const v = goals[field];
    if (v === null || v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      issues.push({ field, code: 'out_of_range', message: `Must be between ${min} and ${max}.` });
    }
  };
  check('maxStandardDrinksPerSession', 0, 30);
  check('maxStandardDrinksPerWeek', 0, 100);
  check('alcoholFreeDaysPerWeek', 0, 7);
  check('paceGoalMinutesBetweenDrinks', 15, 240);
  return issues;
}

export const DEFAULT_GOALS: Omit<UserGoals, 'updatedAt'> = Object.freeze({
  objectives: [],
  maxStandardDrinksPerSession: null,
  maxStandardDrinksPerWeek: null,
  alcoholFreeDaysPerWeek: null,
  paceGoalMinutesBetweenDrinks: null,
}) as Omit<UserGoals, 'updatedAt'>;
