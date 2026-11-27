import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Opens the relevant screen when the user taps a Threshold notification. */
export function useNotificationRouting(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.route === 'checkin' && typeof data.sessionId === 'string') {
        router.push({ pathname: '/checkin', params: { sessionId: data.sessionId } });
      } else if (typeof data?.interventionId === 'string') {
        router.push('/session');
      }
    });
    return () => sub.remove();
  }, [enabled]);
}
