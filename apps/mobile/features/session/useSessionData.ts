import { computePace, findTemplate, type PaceSnapshot } from '@threshold/core';
import type { Beverage, Result, DrinkEvent } from '@threshold/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { useNow } from '../../hooks/useNow';
import { definitionFor } from '../../lib/format';
import { getServices } from '../../services/container';
import { useAppStore } from '../../stores/appStore';
import { useSessionStore } from '../../stores/sessionStore';
import { draftFromBeverage, draftFromTemplate, ensureBeverage, measurementFromDraft } from './drinkInput';

export function useRecentBeverages() {
  return useQuery({
    queryKey: ['beverages', 'recent'],
    queryFn: () => getServices().repos.beverages.listRecent(10),
  });
}

/** Live pace snapshot for the open session; recomputed as time passes. */
export function useLivePace(): PaceSnapshot | null {
  const session = useSessionStore((s) => s.session);
  const drinks = useSessionStore((s) => s.drinks);
  const now = useNow(30_000);
  return useMemo(() => (session ? computePace(session.startedAt, drinks, Math.max(now, session.startedAt)) : null), [session, drinks, now]);
}

export function useQuickLog() {
  const prefs = useAppStore((s) => s.preferences);
  const logDrink = useSessionStore((s) => s.logDrink);
  const qc = useQueryClient();
  const def = definitionFor(prefs);

  const after = (r: Result<DrinkEvent>) => {
    if (r.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['beverages'] });
    }
    return r;
  };

  return {
    def,
    async logBeverage(b: Beverage) {
      const draft = draftFromBeverage(b);
      return after(
        await logDrink({ beverage: { id: b.id, name: b.name, category: b.category }, measurement: measurementFromDraft(draft, def), source: 'quick_log' }),
      );
    },
    async logWater() {
      const t = findTemplate('water_glass');
      if (!t) throw new Error('Water template missing');
      const draft = draftFromTemplate(t);
      const { repos, clock } = getServices();
      const id = await ensureBeverage(repos, draft, clock.now());
      return after(await logDrink({ beverage: { id, name: draft.name, category: draft.category }, measurement: measurementFromDraft(draft, def), source: 'quick_log' }));
    },
  };
}
