import type { UserGoals, UserPreferences } from '@threshold/shared-types';
import { fixedClock } from '../../services/clock';
import { createServices, setServices, type AppServices } from '../../services/container';
import { defaultGoals, defaultPreferences } from '../../services/defaults';
import { UnavailableHealthProvider } from '../../services/health/types';
import { RecordingNotificationGateway } from '../../services/notifications';
import { MemoryResearchStore } from '../../services/research/researchStore';
import { MemoryWatchTransport } from '../../services/watch/watchBridge';
import { createTestDatabase } from './sqljsDatabase';

export const T0 = Date.UTC(2026, 10, 28, 1, 0, 0); // Fri 20:00 in New York

export interface Harness {
  services: AppServices;
  clock: ReturnType<typeof fixedClock>;
  notifications: RecordingNotificationGateway;
  prefs: { current: UserPreferences };
  goals: { current: UserGoals };
  watch: MemoryWatchTransport;
  research: MemoryResearchStore;
}

export async function createHarness(
  options: { cloudSync?: boolean; goals?: Partial<UserGoals>; prefs?: Partial<UserPreferences>; researchEnabled?: boolean; automaticDetectionAllowed?: boolean } = {},
): Promise<Harness> {
  const db = await createTestDatabase();
  const clock = fixedClock(T0, -300);
  const prefs = { current: { ...defaultPreferences(T0, 'US'), ...options.prefs } };
  const goals = { current: { ...defaultGoals(T0), ...options.goals } };
  const notifications = new RecordingNotificationGateway();
  const watch = new MemoryWatchTransport();
  const research = new MemoryResearchStore();
  const services = await createServices({
    db,
    clock,
    getPreferences: () => prefs.current,
    getGoals: () => goals.current,
    cloudSyncAvailable: options.cloudSync ?? false,
    notifications,
    health: new UnavailableHealthProvider(),
    watchTransport: watch,
    researchStore: research,
    researchEnabled: options.researchEnabled ?? false,
    automaticDetectionAllowed: options.automaticDetectionAllowed ?? false,
  });
  setServices(services);
  return { services, clock, notifications, prefs, goals, watch, research };
}
