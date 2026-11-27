import { setIdGenerator } from '@threshold/core';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { getLocales } from 'expo-localization';
import { featureFlags } from '../config/featureFlags';
import { openAppDatabase } from '../database/open';
import { useAppStore } from '../stores/appStore';
import { useSessionStore } from '../stores/sessionStore';
import { systemClock } from './clock';
import { createServices, setServices, type AppServices } from './container';
import { defaultPreferences } from './defaults';
import { HealthKitProvider } from './health/healthkitProvider';
import { configureForegroundPresentation, expoNotificationGateway } from './notifications';
import { ApiClient } from './sync/apiClient';
import { secureTokenStore } from './sync/secureTokenStore';
import { BUNDLED_RECOVERY_MODEL } from '../config/recoveryModel';
import { createNativeResearchStore } from './research/researchStore';
import { createNativeWatchTransport } from './watch/watchBridge';
import { env } from '../config/env';
import { AppState } from 'react-native';
import { queryClient } from './queryClient';

let bootPromise: Promise<AppServices> | null = null;

/**
 * One-time application start-up: CSPRNG ids → encrypted DB + migrations → services → stores.
 * Idempotent; safe to call from multiple components.
 */
export function bootstrap(): Promise<AppServices> {
  if (!bootPromise) {
    bootPromise = run().catch((e: unknown) => {
      bootPromise = null; // allow a retry after a failed start (e.g. device locked)
      throw e;
    });
  }
  return bootPromise;
}

async function run(): Promise<AppServices> {
  setIdGenerator(() => Crypto.randomUUID());
  const { db, encrypted } = await openAppDatabase();
  const country = getLocales()[0]?.regionCode ?? null;
  // Seed pre-hydration defaults from device region (replaced by stored prefs if they exist).
  useAppStore.setState({ preferences: defaultPreferences(systemClock.now(), country), encryptedStorage: encrypted });

  const services = await createServices({
    db,
    clock: systemClock,
    getPreferences: () => useAppStore.getState().preferences,
    getGoals: () => useAppStore.getState().goals,
    cloudSyncAvailable: featureFlags.cloudSync,
    notifications: expoNotificationGateway,
    health: new HealthKitProvider(),
    watchTransport: createNativeWatchTransport(),
    researchStore: createNativeResearchStore(),
    researchEnabled: featureFlags.gestureResearchMode,
    automaticDetectionAllowed: featureFlags.automaticDetectionPrompt,
    recordConsent: (type, granted, version) => useAppStore.getState().recordConsent(type, granted, version),
    recoveryPredictionEnabled: featureFlags.recoveryPrediction,
    recoveryModel: BUNDLED_RECOVERY_MODEL,
    createApi: (deviceId) =>
      env.apiUrl ? new ApiClient(env.apiUrl, secureTokenStore, deviceId, (u, i) => fetch(u, i), 15_000, env.appEnv === 'development') : null,
    notificationsAllowed: () => useAppStore.getState().hasConsent('notifications'),
    hasHealthConsent: () => useAppStore.getState().hasConsent('healthkit'),
    haptic: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  });
  configureForegroundPresentation();
  setServices(services);

  services.sessions.subscribe((change) => {
    useSessionStore.getState().applyChange(change);
    void queryClient.invalidateQueries({ queryKey: ['history'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
  });

  services.interventions.subscribe((sessionId, events) => {
    useSessionStore.getState().appendInterventions(sessionId, events);
  });

  await useAppStore.getState().hydrate();
  await useSessionStore.getState().refresh();
  services.watchSync.start();
  if (services.sync) {
    const trySync = async () => {
      if (!useAppStore.getState().preferences.cloudSyncEnabled || !(await services.api?.isSignedIn())) return;
      await services.sync?.syncNow().catch(() => undefined);
    };
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void trySync();
    });
    services.sessions.subscribe((c) => {
      if (c.reason === 'ended') void trySync();
    });
    void trySync();
  }
  // Health sync runs in the background; failures never block start-up.
  void services.healthService
    .sync(30)
    .then(() => services.recovery.refreshRecent(14)) // new sleep/physiology changes session features
    .then(() => queryClient.invalidateQueries({ queryKey: ['health'] }))
    .then(() => queryClient.invalidateQueries({ queryKey: ['recovery'] }))
    .catch(() => undefined);
  return services;
}
