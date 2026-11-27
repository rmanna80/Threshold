import {
  buildDrinkEvent,
  createSession,
  deleteDrinkEvent,
  editDrinkEvent,
  endSession,
  isWithinSession,
  pauseSession,
  resumeSession,
  type DrinkMeasurementInput,
} from '@threshold/core';
import type {
  BeverageCategory,
  DataSource,
  DrinkEvent,
  DrinkingSession,
  Result,
  SessionStartContext,
  UserGoals,
  ValidationIssue,
} from '@threshold/shared-types';
import { drinkEventSchema, drinkingSessionSchema, parseWith } from '@threshold/validation';
import type { Repositories } from '../database/repositories';
import type { Clock } from './clock';
import type { Outbox } from './outbox';

export interface SessionChange {
  session: DrinkingSession;
  drinks: DrinkEvent[];
  reason: 'started' | 'paused' | 'resumed' | 'ended' | 'drink_added' | 'drink_edited' | 'drink_deleted' | 'remote_update';
  changedDrink?: DrinkEvent;
}

/** Side effects plugged in by later layers (pace engine, notifications, watch sync, query cache). */
export type SessionListener = (change: SessionChange) => void | Promise<void>;

export interface LogDrinkParams {
  beverage: { id: string | null; name: string; category: BeverageCategory };
  measurement: DrinkMeasurementInput;
  consumedAt?: number;
  source: DataSource;
  /** Defaults to the open session. */
  sessionId?: string;
}

function err<T>(code: string, message: string, field = 'session'): Result<T> {
  return { ok: false, errors: [{ field, code, message }] };
}

export class SessionService {
  private listeners = new Set<SessionListener>();

  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
    private readonly deviceId: string,
    private readonly outbox: Outbox,
    private readonly goals: () => UserGoals | null,
  ) {}

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async emit(change: SessionChange): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l(change);
      } catch {
        // Listener failures (e.g. notification permission revoked) must never break logging.
      }
    }
  }

  async getOpenSession(): Promise<DrinkingSession | null> {
    return this.repos.sessions.getOpen();
  }

  async getSessionWithDrinks(sessionId: string): Promise<{ session: DrinkingSession; drinks: DrinkEvent[] } | null> {
    const session = await this.repos.sessions.getById(sessionId);
    if (!session) return null;
    return { session, drinks: await this.repos.drinks.listForSession(sessionId) };
  }

  private async persistSession(session: DrinkingSession, now: number): Promise<void> {
    await this.repos.sessions.upsert(session);
    await this.outbox.record('drinking_session', session, now);
  }

  async startSession(params: { origin: DrinkingSession['origin']; startContext?: SessionStartContext }): Promise<Result<DrinkingSession>> {
    const open = await this.repos.sessions.getOpen();
    if (open) return err('session_already_open', 'An evening session is already in progress.');
    const now = this.clock.now();
    const session = createSession({
      now,
      tzOffsetMin: this.clock.tzOffsetMin(now),
      deviceId: this.deviceId,
      origin: params.origin,
      goals: this.goals(),
      startContext: params.startContext,
    });
    await this.persistSession(session, now);
    await this.emit({ session, drinks: [], reason: 'started' });
    return { ok: true, value: session, warnings: [] };
  }

  private async transition(
    sessionId: string,
    reason: 'paused' | 'resumed' | 'ended',
  ): Promise<Result<DrinkingSession>> {
    const current = await this.repos.sessions.getById(sessionId);
    if (!current) return err('not_found', 'Session not found.');
    const now = this.clock.now();
    const fn = reason === 'paused' ? pauseSession : reason === 'resumed' ? resumeSession : endSession;
    const next = fn(current, now, this.deviceId);
    if (!next.ok) return next;
    await this.persistSession(next.value, now);
    await this.emit({ session: next.value, drinks: await this.repos.drinks.listForSession(sessionId), reason });
    return next;
  }

  pause(sessionId: string) {
    return this.transition(sessionId, 'paused');
  }
  resume(sessionId: string) {
    return this.transition(sessionId, 'resumed');
  }
  end(sessionId: string) {
    return this.transition(sessionId, 'ended');
  }

  async logDrink(params: LogDrinkParams): Promise<Result<DrinkEvent>> {
    const now = this.clock.now();
    let session = params.sessionId ? await this.repos.sessions.getById(params.sessionId) : await this.repos.sessions.getOpen();
    if (!session) return err('no_active_session', 'Start an evening session before logging a drink.');
    const consumedAt = params.consumedAt ?? now;
    if (session.status !== 'ended' && consumedAt < session.startedAt) {
      return err('before_session', 'This time is before the session started.', 'consumedAt');
    }
    if (session.status === 'ended' && !isWithinSession(session, consumedAt)) {
      return err('outside_session', 'This time is outside the selected session.', 'consumedAt');
    }
    const built = buildDrinkEvent({
      sessionId: session.id,
      beverage: params.beverage,
      measurement: params.measurement,
      consumedAt,
      loggedAt: now,
      tzOffsetMin: this.clock.tzOffsetMin(consumedAt),
      source: params.source,
      deviceId: this.deviceId,
    });
    if (!built.ok) return built;
    const drink = built.value;
    const warnings: ValidationIssue[] = [...built.warnings];

    await this.repos.drinks.upsert(drink);
    await this.outbox.record('drink_event', drink, now);
    if (params.beverage.id) await this.repos.beverages.markUsed(params.beverage.id, now);

    // Logging while paused implies the user is drinking again: resume monitoring.
    if (session.status === 'paused') {
      const resumed = resumeSession(session, now, this.deviceId);
      if (resumed.ok) {
        session = resumed.value;
        await this.persistSession(session, now);
        warnings.push({ field: 'session', code: 'auto_resumed', message: 'Your session was resumed.' });
      }
    }
    await this.emit({ session, drinks: await this.repos.drinks.listForSession(session.id), reason: 'drink_added', changedDrink: drink });
    return { ok: true, value: drink, warnings };
  }

  async editDrink(
    drinkId: string,
    edit: { measurement?: DrinkMeasurementInput; consumedAt?: number; beverageName?: string },
  ): Promise<Result<DrinkEvent>> {
    const existing = await this.repos.drinks.getById(drinkId);
    if (!existing) return err('not_found', 'Drink not found.', 'id');
    const session = await this.repos.sessions.getById(existing.sessionId);
    if (!session) return err('not_found', 'Session not found.');
    if (edit.consumedAt !== undefined && edit.consumedAt < session.startedAt) {
      return err('before_session', 'This time is before the session started.', 'consumedAt');
    }
    const now = this.clock.now();
    const next = editDrinkEvent(existing, { ...edit, now, deviceId: this.deviceId });
    if (!next.ok) return next;
    await this.repos.drinks.upsert(next.value);
    await this.outbox.record('drink_event', next.value, now);
    await this.emit({ session, drinks: await this.repos.drinks.listForSession(session.id), reason: 'drink_edited', changedDrink: next.value });
    return next;
  }

  async deleteDrink(drinkId: string): Promise<Result<DrinkEvent>> {
    const existing = await this.repos.drinks.getById(drinkId);
    if (!existing) return err('not_found', 'Drink not found.', 'id');
    if (existing.deletedAt !== null) return { ok: true, value: existing, warnings: [] };
    const now = this.clock.now();
    const tomb = deleteDrinkEvent(existing, now, this.deviceId);
    await this.repos.drinks.upsert(tomb);
    await this.outbox.record('drink_event', tomb, now);
    const session = await this.repos.sessions.getById(existing.sessionId);
    if (session) {
      await this.emit({ session, drinks: await this.repos.drinks.listForSession(session.id), reason: 'drink_deleted', changedDrink: tomb });
    }
    return { ok: true, value: tomb, warnings: [] };
  }

  /**
   * Apply a session/drink produced on another device (watch or cloud). Validated and
   * revision-guarded, so duplicates, replays and out-of-order deliveries are harmless.
   */
  async ingestRemote(
    input: { session?: unknown; drinks?: unknown[] },
  ): Promise<{ applied: number; rejected: string[]; conflicts: string[] }> {
    const rejected: string[] = [];
    const conflicts: string[] = [];
    let applied = 0;
    const now = this.clock.now();
    let session: DrinkingSession | null = null;
    if (input.session !== undefined) {
      const parsed = parseWith(drinkingSessionSchema, input.session);
      if (!parsed.ok) rejected.push(`session: ${parsed.error}`);
      else {
        // Two devices may each start a session while disconnected. The earlier-started session
        // remains the open "evening"; the later one is closed (its drinks stay attached to it).
        const open = await this.repos.sessions.getOpen();
        let incoming = parsed.value;
        if (open && open.id !== incoming.id && incoming.status !== 'ended') {
          if (incoming.startedAt < open.startedAt) {
            const closed = endSession(open, now, this.deviceId);
            if (closed.ok) await this.persistSession(closed.value, now);
            conflicts.push(`closed local session ${open.id} in favour of earlier remote session`);
          } else {
            const closed = endSession(incoming, Math.max(incoming.startedAt, incoming.updatedAt), this.deviceId);
            if (closed.ok) incoming = closed.value;
            conflicts.push(`closed remote session ${incoming.id} in favour of earlier local session`);
          }
        }
        if (await this.repos.sessions.upsert(incoming)) {
          applied += 1;
          await this.outbox.record('drinking_session', incoming, now);
        }
        session = await this.repos.sessions.getById(incoming.id);
      }
    }
    for (const raw of input.drinks ?? []) {
      const parsed = parseWith(drinkEventSchema, raw);
      if (!parsed.ok) {
        rejected.push(`drink: ${parsed.error}`);
        continue;
      }
      const owner = await this.repos.sessions.getById(parsed.value.sessionId);
      if (!owner) {
        rejected.push(`drink ${parsed.value.id}: unknown session`);
        continue;
      }
      if (await this.repos.drinks.upsert(parsed.value)) {
        applied += 1;
        await this.outbox.record('drink_event', parsed.value, now);
      }
      session = owner;
    }
    if (session && applied > 0) {
      await this.emit({ session, drinks: await this.repos.drinks.listForSession(session.id), reason: 'remote_update' });
    }
    return { applied, rejected, conflicts };
  }
}
