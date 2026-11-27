import type { DrinkEvent, DrinkingSession, Result } from '@threshold/shared-types';
import { create } from 'zustand';
import { getServices } from '../services/container';
import type { LogDrinkParams, SessionChange } from '../services/sessionService';
import type { DrinkMeasurementInput } from '@threshold/core';

export interface SessionState {
  session: DrinkingSession | null;
  drinks: DrinkEvent[];
  loaded: boolean;

  refresh(): Promise<void>;
  applyChange(change: SessionChange): void;
  start(): Promise<Result<DrinkingSession>>;
  pause(): Promise<Result<DrinkingSession>>;
  resume(): Promise<Result<DrinkingSession>>;
  end(): Promise<Result<DrinkingSession>>;
  logDrink(params: LogDrinkParams): Promise<Result<DrinkEvent>>;
  editDrink(id: string, edit: { measurement?: DrinkMeasurementInput; consumedAt?: number; beverageName?: string }): Promise<Result<DrinkEvent>>;
  deleteDrink(id: string): Promise<Result<DrinkEvent>>;
}

const noSession = <T,>(): Result<T> => ({
  ok: false,
  errors: [{ field: 'session', code: 'no_active_session', message: 'No evening session is in progress.' }],
});

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  drinks: [],
  loaded: false,

  async refresh() {
    const { sessions, repos } = getServices();
    const open = await sessions.getOpenSession();
    set({ session: open, drinks: open ? await repos.drinks.listForSession(open.id) : [], loaded: true });
  },

  applyChange(change) {
    const current = get().session;
    if (change.session.status === 'ended') {
      if (current?.id === change.session.id) set({ session: null, drinks: [] });
      return;
    }
    if (!current || current.id === change.session.id) {
      set({ session: change.session, drinks: change.drinks });
    }
  },

  start: () => getServices().sessions.startSession({ origin: 'phone' }),
  pause: async () => {
    const s = get().session;
    return s ? getServices().sessions.pause(s.id) : noSession();
  },
  resume: async () => {
    const s = get().session;
    return s ? getServices().sessions.resume(s.id) : noSession();
  },
  end: async () => {
    const s = get().session;
    return s ? getServices().sessions.end(s.id) : noSession();
  },
  logDrink: (params) => getServices().sessions.logDrink(params),
  editDrink: (id, edit) => getServices().sessions.editDrink(id, edit),
  deleteDrink: (id) => getServices().sessions.deleteDrink(id),
}));
