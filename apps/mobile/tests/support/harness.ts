import type { UserGoals, UserPreferences } from '@threshold/shared-types';
import { fixedClock } from '../../services/clock';
import { createServices, setServices, type AppServices } from '../../services/container';
import { defaultGoals, defaultPreferences } from '../../services/defaults';
import { UnavailableHealthProvider } from '../../services/health/types';
import { RecordingNotificationGateway } from '../../services/notifications';
import { createTestDatabase } from './sqljsDatabase';

export const T0 = Date.UTC(2026, 10, 28, 1, 0, 0); // Fri 20:00 in New York

export interface Harness {
  services: AppServices;
  clock: ReturnType<typeof fixedClock>;
  notifications: RecordingNotificationGateway;
  prefs: { current: UserPreferences };
  goals: { current: UserGoals };
}

export async function createHarness(options: { cloudSync?: boolean; goals?: Partial<UserGoals>; prefs?: Partial<UserPreferences> } = {}): Promise<Harness> {
  const db = await createTestDatabase();
  const clock = fixedClock(T0, -300);
  const prefs = { current: { ...defaultPreferences(T0, 'US'), ...options.prefs } };
  const goals = { current: { ...defaultGoals(T0), ...options.goals } };
  const notifications = new RecordingNotificationGateway();
  const services = await createServices({
    db,
    clock,
    getPreferences: () => prefs.current,
    getGoals: () => goals.current,
    cloudSyncAvailable: options.cloudSync ?? false,
    notifications,
    health: new UnavailableHealthProvider(),
  });
  setServices(services);
  return { services, clock, notifications, prefs, goals };
}
