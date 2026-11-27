import { newId, type RecoveryModelManifest } from '@threshold/core';
import type { ConsentType, UserGoals, UserPreferences } from '@threshold/shared-types';
import { createRepositories, type Repositories } from '../database/repositories';
import type { SqlDatabase } from '../database/types';
import type { Clock } from './clock';
import { defaultGoals, defaultPreferences } from './defaults';
import { HealthService } from './health/healthService';
import type { HealthDataProvider } from './health/types';
import type { NotificationGateway } from './notifications';
import { InterventionService } from './interventionService';
import { Outbox } from './outbox';
import { RecoveryPredictionService } from './recovery/recoveryPredictionService';
import { RecoveryReminderService } from './recoveryReminderService';
import { ResearchService } from './research/researchService';
import type { ResearchFileStore } from './research/researchStore';
import { SessionService } from './sessionService';
import type { ApiClient } from './sync/apiClient';
import { SyncService } from './sync/syncService';
import type { WatchTransport } from './watch/watchBridge';
import { WatchSyncService } from './watch/watchSyncService';

/**
 * Dependency-injection root. Everything platform-specific is passed in so the same wiring runs
 * on device (expo-sqlite, native modules) and in tests (sql.js, fakes).
 */
export interface AppServices {
  db: SqlDatabase;
  repos: Repositories;
  clock: Clock;
  deviceId: string;
  outbox: Outbox;
  sessions: SessionService;
  notifications: NotificationGateway;
  health: HealthDataProvider;
  interventions: InterventionService;
  healthService: HealthService;
  watchSync: WatchSyncService;
  api: ApiClient | null;
  sync: SyncService | null;
  reminders: RecoveryReminderService;
  research: ResearchService;
  recovery: RecoveryPredictionService;
}

export interface CreateServicesParams {
  db: SqlDatabase;
  clock: Clock;
  getPreferences: () => UserPreferences | null;
  getGoals: () => UserGoals | null;
  cloudSyncAvailable: boolean;
  notifications: NotificationGateway;
  health: HealthDataProvider;
  haptic?: () => void;
  hasHealthConsent?: () => boolean;
  watchTransport: WatchTransport;
  createApi?: (deviceId: string) => ApiClient | null;
  notificationsAllowed?: () => boolean;
  researchStore: ResearchFileStore;
  /** Research build flag (feature flag `gestureResearchMode`). */
  researchEnabled: boolean;
  /** Feature flag `automaticDetectionPrompt`. */
  automaticDetectionAllowed?: boolean;
  /** Persists a consent record (defaults to writing directly to the repository). */
  recordConsent?: (type: ConsentType, granted: boolean, version: string) => Promise<void>;
  /** Feature flag `recoveryPrediction`. */
  recoveryPredictionEnabled?: boolean;
  /** Bundled validated recovery model manifest (null in this build). */
  recoveryModel?: RecoveryModelManifest | null;
}

export async function getOrCreateDeviceId(repos: Repositories, now: number): Promise<string> {
  const existing = await repos.kv.get('device_id');
  if (existing) return existing;
  // Random install-scoped identifier; never derived from hardware identifiers.
  const id = newId();
  await repos.kv.set('device_id', id, now);
  return id;
}

export async function createServices(params: CreateServicesParams): Promise<AppServices> {
  const repos = createRepositories(params.db);
  const deviceId = await getOrCreateDeviceId(repos, params.clock.now());
  const outbox = new Outbox(
    repos.syncQueue,
    () => params.cloudSyncAvailable && (params.getPreferences()?.cloudSyncEnabled ?? false),
    deviceId,
  );
  const sessions = new SessionService(repos, params.clock, deviceId, outbox, params.getGoals);
  const healthService = new HealthService(repos, params.health, params.clock, () => params.hasHealthConsent?.() ?? false);
  const interventions = new InterventionService({
    repos,
    clock: params.clock,
    notifications: params.notifications,
    getPreferences: params.getPreferences,
    getGoals: params.getGoals,
    getPhysiology: () => healthService.physiologyForSession(),
    haptic: params.haptic,
  });
  sessions.subscribe((change) => interventions.onSessionChange(change).then(() => undefined));
  const reminders = new RecoveryReminderService(repos, params.notifications, params.clock, () => params.notificationsAllowed?.() ?? true);
  sessions.subscribe((change) => reminders.onSessionChange(change));
  const recordConsent =
    params.recordConsent ??
    (async (type: ConsentType, granted: boolean, version: string) => {
      await repos.settings.recordConsent({ id: newId(), type, granted, version, recordedAt: params.clock.now() });
    });
  const research = new ResearchService(repos, params.researchStore, params.clock, params.researchEnabled, recordConsent);
  await research.load();
  const watchSync = new WatchSyncService(
    params.watchTransport,
    repos,
    sessions,
    params.clock,
    deviceId,
    () => params.getPreferences() ?? defaultPreferences(params.clock.now(), null),
    () => params.getGoals() ?? defaultGoals(params.clock.now()),
    { automaticDetectionAllowed: params.automaticDetectionAllowed ?? false, getResearchPrefs: () => research.watchPrefs() },
  );
  research.subscribe(() => void watchSync.pushContext());
  const recovery = new RecoveryPredictionService(repos, params.clock, {
    enabled: params.recoveryPredictionEnabled ?? false,
    manifest: params.recoveryModel ?? null,
  });
  sessions.subscribe((change) => {
    // Features describe finished evenings; keep them current when an ended session changes.
    if (change.session.status === 'ended') void recovery.computeFeatures(change.session.id).catch(() => undefined);
  });
  const api = params.cloudSyncAvailable ? (params.createApi?.(deviceId) ?? null) : null;
  const sync = api ? new SyncService(api, repos, sessions, outbox, params.clock, deviceId) : null;
  return {
    db: params.db,
    repos,
    clock: params.clock,
    deviceId,
    outbox,
    sessions,
    notifications: params.notifications,
    health: params.health,
    interventions,
    healthService,
    watchSync,
    api,
    sync,
    reminders,
    research,
    recovery,
  };
}

let current: AppServices | null = null;

export function setServices(services: AppServices | null): void {
  current = services;
}

export function getServices(): AppServices {
  if (!current) throw new Error('Services not initialised. Bootstrap must complete before use.');
  return current;
}

export function hasServices(): boolean {
  return current !== null;
}
