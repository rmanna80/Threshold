import * as Notifications from 'expo-notifications';

/**
 * Local notification gateway. Threshold uses on-device local notifications only (no remote push
 * server), so moderation prompts work offline.
 */
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export interface NotificationGateway {
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  /** Deliver now. Returns the platform id. */
  present(content: { title: string; body: string; data?: Record<string, string> }): Promise<string | null>;
  /** Deliver after a delay (e.g. a gentle check-in reminder). */
  schedule(content: { title: string; body: string; data?: Record<string, string> }, afterSeconds: number): Promise<string | null>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
}

function map(status: Notifications.PermissionStatus | string): NotificationPermission {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

export function configureForegroundPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export const expoNotificationGateway: NotificationGateway = {
  async getPermission() {
    const r = await Notifications.getPermissionsAsync();
    return map(r.status);
  },
  async requestPermission() {
    const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    return map(r.status);
  },
  async present(content) {
    if ((await this.getPermission()) !== 'granted') return null;
    return Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, data: content.data ?? {}, sound: false },
      trigger: null,
    });
  },
  async schedule(content, afterSeconds) {
    if ((await this.getPermission()) !== 'granted') return null;
    return Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, data: content.data ?? {}, sound: false },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(afterSeconds)) },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
  async cancelAll() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  },
};

/** Used in tests and when notifications are unavailable; records calls without delivering. */
export class RecordingNotificationGateway implements NotificationGateway {
  delivered: { title: string; body: string; data?: Record<string, string> }[] = [];
  scheduled: { id: string; title: string; body: string; afterSeconds: number }[] = [];
  constructor(public permission: NotificationPermission = 'granted') {}
  async getPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
  async present(content: { title: string; body: string; data?: Record<string, string> }) {
    if (this.permission !== 'granted') return null;
    this.delivered.push(content);
    return `n${this.delivered.length}`;
  }
  async schedule(content: { title: string; body: string }, afterSeconds: number) {
    if (this.permission !== 'granted') return null;
    const id = `s${this.scheduled.length + 1}`;
    this.scheduled.push({ id, ...content, afterSeconds });
    return id;
  }
  async cancel(id: string) {
    this.scheduled = this.scheduled.filter((s) => s.id !== id);
  }
  async cancelAll() {
    this.scheduled = [];
  }
}
