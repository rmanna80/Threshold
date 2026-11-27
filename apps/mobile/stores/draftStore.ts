import { create } from 'zustand';
import type { DrinkDraft } from '../features/session/drinkInput';

/** Hands a drink draft between screens (e.g. label scan → logging sheet). Never persisted. */
export const useDraftStore = create<{ draft: DrinkDraft | null; set(d: DrinkDraft | null): void }>((set) => ({
  draft: null,
  set: (draft) => set({ draft }),
}));
