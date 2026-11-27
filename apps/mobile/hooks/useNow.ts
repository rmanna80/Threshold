import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Re-renders on an interval while the app is in the foreground so durations stay current.
 * Updates immediately when the app returns to the foreground.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    let timer: ReturnType<typeof setInterval> | null = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        tick();
        if (!timer) timer = setInterval(tick, intervalMs);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}
