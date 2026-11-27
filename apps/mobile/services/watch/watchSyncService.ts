import { BEVERAGE_TEMPLATES } from '@threshold/core';
import type { UserGoals, UserPreferences } from '@threshold/shared-types';
import type { Repositories } from '../../database/repositories';
import { definitionFor } from '../../lib/format';
import type { Clock } from '../clock';
import type { SessionService } from '../sessionService';
import { decodeInbound, encodeContext, type WatchBeverage, type WatchContext } from './protocol';
import type { WatchState, WatchTransport } from './watchBridge';

export interface WatchSyncOptions {
  /** Gesture prompts may be enabled on the watch only when the feature flag allows it. */
  automaticDetectionAllowed: boolean;
  /** Research recorder settings for the watch (null hides the recorder). */
  getResearchPrefs?: () => { researchRecording: true; participantId: string; dominantHand: 'left' | 'right' } | null;
}

/**
 * Keeps the watch in step with the phone:
 *  - Phone → watch: the latest state (open session, its drinks, goals, preferences, recent
 *    beverages) via the WatchConnectivity application context (latest value wins).
 *  - Watch → phone: queued `transferUserInfo` records, persisted by the native inbox until this
 *    service validates, applies (revision-guarded) and acknowledges them.
 */
export class WatchSyncService {
  private processing: Promise<void> | null = null;
  private rerun = false;
  private stops: (() => void)[] = [];

  constructor(
    private readonly transport: WatchTransport,
    private readonly repos: Repositories,
    private readonly sessions: SessionService,
    private readonly clock: Clock,
    private readonly deviceId: string,
    private readonly getPreferences: () => UserPreferences,
    private readonly getGoals: () => UserGoals,
    private readonly options: WatchSyncOptions = { automaticDetectionAllowed: false },
  ) {}

  get available(): boolean {
    return this.transport.available;
  }

  getState(): Promise<WatchState> {
    return this.transport.getState();
  }

  start(): void {
    if (!this.transport.available) return;
    this.stops.push(this.transport.onMessage(() => void this.processInbox()));
    this.stops.push(this.sessions.subscribe(() => this.pushContext()));
    void this.processInbox();
    void this.pushContext();
  }

  stop(): void {
    for (const s of this.stops) s();
    this.stops = [];
  }

  async buildContext(): Promise<WatchContext> {
    const prefs = this.getPreferences();
    const goals = this.getGoals();
    const def = definitionFor(prefs);
    const open = await this.repos.sessions.getOpen();
    const drinks = open ? await this.repos.drinks.listForSession(open.id, true) : [];
    const recent = await this.repos.beverages.listRecent(8);
    const fromRecent: WatchBeverage[] = recent.map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      servingValue: b.defaultServing.value,
      servingUnit: b.defaultServing.unit,
      abvPercent: b.abvPercent,
    }));
    const defaults: WatchBeverage[] = BEVERAGE_TEMPLATES.filter((t) => t.abvPercent !== null && ['beer_regular_12oz', 'wine_red_5oz', 'spirit_shot_1_5oz', 'seltzer_12oz', 'water_glass'].includes(t.key)).map((t) => ({
      id: `template:${t.key}`,
      name: t.name,
      category: t.category,
      servingValue: t.defaultServing.value,
      servingUnit: t.defaultServing.unit,
      abvPercent: t.abvPercent,
    }));
    const seen = new Set<string>();
    const beverages = [...fromRecent, ...defaults].filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true))).slice(0, 10);
    return {
      generatedAt: this.clock.now(),
      phoneDeviceId: this.deviceId,
      activeSession: open,
      drinks,
      goals: open?.goalSnapshot ?? {
        maxStandardDrinksPerSession: goals.maxStandardDrinksPerSession,
        paceGoalMinutesBetweenDrinks: goals.paceGoalMinutesBetweenDrinks,
      },
      prefs: {
        standardDrinkGrams: def.gramsEthanol,
        label: def.label,
        labelPlural: def.labelPlural,
        notificationFrequency: prefs.notificationFrequency,
        quietMode: prefs.quietMode,
        unitSystem: prefs.unitSystem,
        automaticDetectionEnabled: this.options.automaticDetectionAllowed && prefs.automaticDetectionEnabled,
        ...(this.options.getResearchPrefs?.() ?? {}),
      },
      beverages,
    };
  }

  async pushContext(): Promise<void> {
    if (!this.transport.available) return;
    try {
      await this.transport.updateContext(encodeContext(await this.buildContext()));
    } catch {
      // Watch not paired / app not installed: nothing to do; next change retries.
    }
  }

  /** Serialised so concurrent notifications never apply the same message twice. */
  processInbox(): Promise<void> {
    if (this.processing) {
      this.rerun = true; // a message arrived mid-drain; drain again afterwards
      return this.processing;
    }
    this.processing = (async () => {
      do {
        this.rerun = false;
        await this.drain();
      } while (this.rerun);
    })().finally(() => {
      this.processing = null;
    });
    return this.processing;
  }

  private async drain(): Promise<void> {
    const messages = await this.transport.drainInbox();
    const done: string[] = [];
    let needsContext = false;
    for (const raw of messages) {
      const decoded = decodeInbound(raw);
      if (!decoded.ok) {
        if (decoded.id) done.push(decoded.id); // drop malformed messages permanently
        continue;
      }
      const m = decoded.message;
      if (m.type === 'request_context') needsContext = true;
      else {
        // Applying is idempotent (revision-guarded), so a crash before acknowledgement is safe:
        // the native inbox will redeliver and the replay changes nothing.
        for (const s of m.sessions) await this.sessions.ingestRemote({ session: s });
        await this.sessions.ingestRemote({ drinks: m.drinks });
        needsContext = true;
      }
      await this.repos.processedMessages.markProcessed(m.id, 'watch', this.clock.now());
      done.push(m.id);
    }
    if (done.length) await this.transport.acknowledge(done);
    if (needsContext) await this.pushContext();
  }
}
