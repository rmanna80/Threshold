import { setIdGenerator } from '@threshold/core';
import * as Crypto from 'expo-crypto';
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
  });
  configureForegroundPresentation();
  setServices(services);

  services.sessions.subscribe((change) => {
    useSessionStore.getState().applyChange(change);
    void queryClient.invalidateQueries({ queryKey: ['history'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
  });

  await useAppStore.getState().hydrate();
  await useSessionStore.getState().refresh();
  return services;
}
