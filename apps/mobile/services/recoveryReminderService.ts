import { nextCheckinReminderAt } from '@threshold/core';
import type { Repositories } from '../database/repositories';
import type { Clock } from './clock';
import type { NotificationGateway } from './notifications';
import type { SessionChange } from './sessionService';

/**
 * Schedules a single, gentle morning check-in reminder after a session ends (09:00 local, at
 * least four hours later) and cancels it once the check-in is completed.
 */
export class RecoveryReminderService {
  constructor(
    private readonly repos: Repositories,
    private readonly notifications: NotificationGateway,
    private readonly clock: Clock,
    private readonly notificationsAllowed: () => boolean,
  ) {}

  private key(sessionId: string) {
    return `checkin_reminder:${sessionId}`;
  }

  async onSessionChange(change: SessionChange): Promise<void> {
    if (change.reason !== 'ended' || !change.session.endedAt || !this.notificationsAllowed()) return;
    const alcoholic = change.drinks.some((d) => d.deletedAt === null && d.isAlcoholic);
    if (!alcoholic) return;
    const at = nextCheckinReminderAt(change.session.endedAt, change.session.tzOffsetMin);
    const seconds = Math.max(60, (at - this.clock.now()) / 1000);
    const id = await this.notifications.schedule(
      { title: 'Morning check-in', body: 'How are you feeling after last night? It takes under 30 seconds.', data: { route: 'checkin', sessionId: change.session.id } },
      seconds,
    );
    if (id) await this.repos.kv.set(this.key(change.session.id), id, this.clock.now());
  }

  async onCheckinSaved(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const id = await this.repos.kv.get(this.key(sessionId));
    if (id) {
      await this.notifications.cancel(id).catch(() => undefined);
      await this.repos.kv.delete(this.key(sessionId));
    }
  }
}
