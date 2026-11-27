import type {
  DrinkingSession,
  EpochMs,
  Result,
  SessionGoalSnapshot,
  SessionStartContext,
  TzOffsetMin,
  UserGoals,
} from '@threshold/shared-types';
import { newId } from './ids';

export const EMPTY_START_CONTEXT: SessionStartContext = Object.freeze({
  restingHeartRateBpm: null,
  hrvSdnnMs: null,
  lastNightSleepMinutes: null,
  healthDataAuthorized: false,
}) as SessionStartContext;

export interface CreateSessionParams {
  now: EpochMs;
  tzOffsetMin: TzOffsetMin;
  deviceId: string;
  origin: DrinkingSession['origin'];
  goals: Pick<UserGoals, 'maxStandardDrinksPerSession' | 'paceGoalMinutesBetweenDrinks'> | null;
  startContext?: SessionStartContext;
  id?: string;
}

export function goalSnapshotFrom(goals: CreateSessionParams['goals']): SessionGoalSnapshot {
  return {
    maxStandardDrinksPerSession: goals?.maxStandardDrinksPerSession ?? null,
    paceGoalMinutesBetweenDrinks: goals?.paceGoalMinutesBetweenDrinks ?? null,
  };
}

export function createSession(params: CreateSessionParams): DrinkingSession {
  return {
    id: params.id ?? newId(),
    status: 'active',
    startedAt: params.now,
    endedAt: null,
    tzOffsetMin: params.tzOffsetMin,
    pauses: [],
    startContext: params.startContext ?? { ...EMPTY_START_CONTEXT },
    goalSnapshot: goalSnapshotFrom(params.goals),
    origin: params.origin,
    revision: 1,
    updatedAt: params.now,
    deletedAt: null,
    deviceId: params.deviceId,
  };
}

function fail(code: string, message: string): Result<DrinkingSession> {
  return { ok: false, errors: [{ field: 'status', code, message }] };
}

function bump(session: DrinkingSession, now: EpochMs, deviceId: string, patch: Partial<DrinkingSession>): DrinkingSession {
  return { ...session, ...patch, revision: session.revision + 1, updatedAt: now, deviceId };
}

export function pauseSession(session: DrinkingSession, now: EpochMs, deviceId: string): Result<DrinkingSession> {
  if (session.status !== 'active') return fail('invalid_transition', 'Only an active session can be paused.');
  if (now < session.startedAt) return fail('invalid_time', 'Pause time precedes session start.');
  return {
    ok: true,
    warnings: [],
    value: bump(session, now, deviceId, {
      status: 'paused',
      pauses: [...session.pauses, { startedAt: now, endedAt: null }],
    }),
  };
}

export function resumeSession(session: DrinkingSession, now: EpochMs, deviceId: string): Result<DrinkingSession> {
  if (session.status !== 'paused') return fail('invalid_transition', 'Only a paused session can be resumed.');
  const pauses = session.pauses.map((p, i) =>
    i === session.pauses.length - 1 && p.endedAt === null ? { ...p, endedAt: Math.max(now, p.startedAt) } : p,
  );
  return { ok: true, warnings: [], value: bump(session, now, deviceId, { status: 'active', pauses }) };
}

export function endSession(session: DrinkingSession, now: EpochMs, deviceId: string): Result<DrinkingSession> {
  if (session.status === 'ended') return fail('invalid_transition', 'This session has already ended.');
  const endedAt = Math.max(now, session.startedAt);
  const pauses = session.pauses.map((p) => (p.endedAt === null ? { ...p, endedAt: Math.max(endedAt, p.startedAt) } : p));
  return { ok: true, warnings: [], value: bump(session, now, deviceId, { status: 'ended', endedAt, pauses }) };
}

/** Wall-clock duration from start to end (or now). */
export function sessionDurationMs(session: DrinkingSession, now: EpochMs): number {
  const end = session.endedAt ?? now;
  return Math.max(0, end - session.startedAt);
}

/** Duration excluding paused intervals. */
export function activeDurationMs(session: DrinkingSession, now: EpochMs): number {
  const end = session.endedAt ?? now;
  const paused = session.pauses.reduce((acc, p) => {
    const pEnd = p.endedAt ?? end;
    return acc + Math.max(0, Math.min(pEnd, end) - Math.max(p.startedAt, session.startedAt));
  }, 0);
  return Math.max(0, end - session.startedAt - paused);
}

export function isOpen(session: DrinkingSession): boolean {
  return session.status !== 'ended' && session.deletedAt === null;
}

/** A drink may be attributed to a session if consumed between start and end (inclusive). */
export function isWithinSession(session: DrinkingSession, at: EpochMs, toleranceMs = 0): boolean {
  if (at < session.startedAt - toleranceMs) return false;
  if (session.endedAt !== null && at > session.endedAt + toleranceMs) return false;
  return true;
}
