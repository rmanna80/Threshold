import { newId } from '@threshold/core';
import type { UserGoals, UserPreferences } from '@threshold/shared-types';
import { createRepositories, type Repositories } from '../database/repositories';
import type { SqlDatabase } from '../database/types';
import type { Clock } from './clock';
import { defaultGoals, defaultPreferences } from './defaults';
import { HealthService } from './health/healthService';
import type { HealthDataProvider } from './health/types';
import type { NotificationGateway } from './notifications';
import { InterventionService } from './interventionService';
import { Outbox } from './outbox';
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
  const watchSync = new WatchSyncService(
    params.watchTransport,
    repos,
    sessions,
    params.clock,
    deviceId,
    () => params.getPreferences() ?? defaultPreferences(params.clock.now(), null),
    () => params.getGoals() ?? defaultGoals(params.clock.now()),
  );
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
