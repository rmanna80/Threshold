import {
  DAY_MS,
  buildSessionFeatures,
  decideRecoveryPrediction,
  newId,
  nightAfterSession,
  overnightPhysiology,
  summarizeSleep,
  type HistoryItem,
  type RecoveryDecision,
  type RecoveryModelManifest,
  type SessionFeatures,
} from '@threshold/core';
import type { DrinkingSession, Measurement } from '@threshold/shared-types';
import type { Repositories } from '../../database/repositories';
import type { Clock } from '../clock';

export interface RecoveryOutlook {
  sessionId: string;
  features: SessionFeatures;
  decision: RecoveryDecision;
}

const HISTORY_LIMIT = 60;

/**
 * Builds session features (spec sf-v1) from local records and runs the prediction gate.
 * Every decision — shown or withheld — is written to `model_predictions` for auditability.
 */
export class RecoveryPredictionService {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
    private readonly options: { enabled: boolean; manifest: RecoveryModelManifest | null },
  ) {}

  private async inputsFor(session: DrinkingSession) {
    const drinks = await this.repos.drinks.listForSession(session.id, true);
    const priorDrinks = (await this.repos.drinks.listBetween(session.startedAt - 7 * DAY_MS, session.startedAt)).filter((d) => d.sessionId !== session.id);
    const priorSessionStarts = (await this.repos.sessions.listAll()).filter((s) => s.id !== session.id).map((s) => s.startedAt);
    const end = session.endedAt ?? this.clock.now();
    const health = await this.repos.measurements.list(
      ['sleep_asleep', 'sleep_in_bed', 'sleep_awake', 'resting_heart_rate', 'hrv_sdnn'],
      session.startedAt - 30 * DAY_MS,
      end + 2 * DAY_MS,
    );
    const tz = session.tzOffsetMin;
    const counted = drinks.filter((d) => d.deletedAt === null && d.isAlcoholic && d.confirmation !== 'detected_unconfirmed').map((d) => d.consumedAt);
    const lastDrinkAt = counted.length ? Math.max(...counted) : null;
    const nights = summarizeSleep(health.filter((m) => m.kind.startsWith('sleep_')), tz);
    const sleep = nightAfterSession(nights, session, lastDrinkAt);
    const samples = (kind: Measurement['kind']) => health.filter((m) => m.kind === kind).map((m) => ({ value: m.value, at: m.startAt, tzOffsetMin: tz }));
    const phys = overnightPhysiology({ sessionStartedAt: session.startedAt, sleep, restingHr: samples('resting_heart_rate'), hrv: samples('hrv_sdnn') });
    return { session, drinks, priorDrinks, priorSessionStarts, sleep, ...phys };
  }

  /** Recompute and store features for one session (null if it does not exist or was deleted). */
  async computeFeatures(sessionId: string): Promise<SessionFeatures | null> {
    const session = await this.repos.sessions.getById(sessionId);
    if (!session || session.deletedAt !== null) return null;
    const features = buildSessionFeatures(await this.inputsFor(session));
    await this.repos.sessionFeatures.upsert(sessionId, features, this.clock.now());
    return features;
  }

  /** Refresh features for recently ended sessions (e.g. after new sleep data arrives). */
  async refreshRecent(days = 14): Promise<number> {
    const now = this.clock.now();
    const recent = (await this.repos.sessions.listBetween(now - days * DAY_MS, now)).filter((s) => s.endedAt !== null);
    for (const s of recent) await this.computeFeatures(s.id);
    return recent.length;
  }

  private async history(before: number): Promise<HistoryItem[]> {
    const sessions = (await this.repos.sessions.listAll()).filter((s) => s.endedAt !== null && s.endedAt < before).slice(-HISTORY_LIMIT);
    const out: HistoryItem[] = [];
    for (const s of sessions) {
      const c = await this.repos.checkins.forSession(s.id);
      if (!c || c.deletedAt !== null || c.overallSeverity === null) continue;
      const f = (await this.repos.sessionFeatures.get(s.id)) ?? (await this.computeFeatures(s.id));
      if (f) out.push({ values: f.values, severity: c.overallSeverity });
    }
    return out;
  }

  async outlookFor(sessionId: string): Promise<RecoveryOutlook | null> {
    const features = await this.computeFeatures(sessionId);
    const session = await this.repos.sessions.getById(sessionId);
    if (!features || !session) return null;
    const { manifest, enabled } = this.options;
    // History is only needed (and only read) when a usable model could use it.
    const history = enabled && manifest ? await this.history(session.startedAt) : [];
    const decision = decideRecoveryPrediction({ enabled, manifest, features, history });
    await this.repos.predictions.record({
      id: newId(),
      sessionId,
      modelId: manifest?.modelId ?? 'recovery_risk:none',
      modelVersion: manifest?.version ?? '0',
      predictedAt: this.clock.now(),
      inputQuality: features.inputQuality,
      featureAvailability: { ...features.availability },
      probability: decision.status === 'shown' ? decision.probability : null,
      interval: decision.status === 'shown' ? decision.interval : null,
      status: decision.status,
      withheldReason: decision.status === 'withheld' ? decision.reason : null,
    });
    return { sessionId, features, decision };
  }
}
