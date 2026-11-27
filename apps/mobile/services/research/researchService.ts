import type { ConsentType } from '@threshold/shared-types';
import type { Repositories } from '../../database/repositories';
import type { Clock } from '../clock';
import type { ResearchFileStore, ResearchRecordingInfo } from './researchStore';

export type DominantHand = 'left' | 'right';

export interface ResearchSettings {
  participantId: string;
  dominantHand: DominantHand;
  recordingEnabled: boolean;
  enrolledAt: number;
  consentVersion: string;
}

/** What the watch needs to show the recorder. Null means the recorder stays hidden. */
export interface WatchResearchPrefs {
  researchRecording: true;
  participantId: string;
  dominantHand: DominantHand;
}

const KEY = 'research.settings';
/** Pseudonymous study code — never a name, email or phone number. */
export const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
export const RESEARCH_CONSENT_VERSION = 'gesture-v1';

/**
 * Internal gesture-research enrolment (research builds only).
 *
 * - Enrolment requires explicit consent and a pseudonymous participant code.
 * - Recordings arrive from the watch as JSONL files and stay on this phone. They leave only when
 *   the participant shares a file themselves (share sheet); Threshold never uploads them.
 * - Withdrawing deletes every recording on the phone and stops accepting new ones.
 */
export class ResearchService {
  private cached: ResearchSettings | null = null;
  private loaded = false;
  private listeners = new Set<() => void>();

  constructor(
    private readonly repos: Repositories,
    private readonly store: ResearchFileStore,
    private readonly clock: Clock,
    private readonly enabledInBuild: boolean,
    private readonly recordConsent: (type: ConsentType, granted: boolean, version: string) => Promise<void>,
  ) {}

  get availableInBuild(): boolean {
    return this.enabledInBuild;
  }

  get storeAvailable(): boolean {
    return this.store.available;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  async load(): Promise<ResearchSettings | null> {
    if (this.loaded) return this.cached;
    const raw = await this.repos.kv.get(KEY);
    this.cached = raw ? (JSON.parse(raw) as ResearchSettings) : null;
    this.loaded = true;
    if (!this.enabledInBuild && this.cached) {
      // A non-research build must not keep research state around.
      await this.withdraw();
    } else {
      await this.store.setAccepting(Boolean(this.cached?.recordingEnabled));
    }
    return this.cached;
  }

  /** Synchronous snapshot for the watch context (call `load()` once at start-up). */
  watchPrefs(): WatchResearchPrefs | null {
    const s = this.cached;
    if (!this.enabledInBuild || !s || !s.recordingEnabled) return null;
    return { researchRecording: true, participantId: s.participantId, dominantHand: s.dominantHand };
  }

  async enroll(participantId: string, dominantHand: DominantHand): Promise<ResearchSettings> {
    if (!this.enabledInBuild) throw new Error('Research recording is not available in this build.');
    const code = participantId.trim();
    if (!PARTICIPANT_ID_PATTERN.test(code)) {
      throw new Error('Use the 3–32 character study code you were given (letters, numbers, - or _).');
    }
    await this.recordConsent('research_recording', true, RESEARCH_CONSENT_VERSION);
    const settings: ResearchSettings = {
      participantId: code,
      dominantHand,
      recordingEnabled: false,
      enrolledAt: this.clock.now(),
      consentVersion: RESEARCH_CONSENT_VERSION,
    };
    await this.save(settings);
    return settings;
  }

  async setRecordingEnabled(on: boolean): Promise<void> {
    const s = await this.load();
    if (!s) throw new Error('Enrol in the study before recording.');
    await this.save({ ...s, recordingEnabled: on });
    await this.store.setAccepting(on);
  }

  /** Withdraw: deletes every recording on this phone and the enrolment itself. */
  async withdraw(): Promise<void> {
    await this.store.setAccepting(false);
    await this.store.removeAll();
    await this.repos.kv.delete(KEY);
    const wasEnrolled = this.cached !== null;
    this.cached = null;
    this.loaded = true;
    if (wasEnrolled) await this.recordConsent('research_recording', false, RESEARCH_CONSENT_VERSION);
    this.emit();
  }

  list(): Promise<ResearchRecordingInfo[]> {
    return this.store.list();
  }

  remove(id: string): Promise<void> {
    return this.store.remove(id);
  }

  onFile(l: (info: { id: string; accepted: boolean }) => void): () => void {
    return this.store.onFile(l);
  }

  private async save(s: ResearchSettings): Promise<void> {
    await this.repos.kv.set(KEY, JSON.stringify(s), this.clock.now());
    this.cached = s;
    this.loaded = true;
    this.emit();
  }
}
