import type { DrinkEvent, DrinkingSession, InterventionEvent, Result } from '@threshold/shared-types';
import { create } from 'zustand';
import { getServices } from '../services/container';
import type { LogDrinkParams, SessionChange } from '../services/sessionService';
import type { DrinkMeasurementInput } from '@threshold/core';

export interface SessionState {
  session: DrinkingSession | null;
  drinks: DrinkEvent[];
  interventions: InterventionEvent[];
  loaded: boolean;

  refresh(): Promise<void>;
  applyChange(change: SessionChange): void;
  appendInterventions(sessionId: string, events: InterventionEvent[]): void;
  acknowledgeIntervention(id: string, dismissed: boolean): Promise<void>;
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
  interventions: [],
  loaded: false,

  async refresh() {
    const { sessions, repos } = getServices();
    const open = await sessions.getOpenSession();
    set({
      session: open,
      drinks: open ? await repos.drinks.listForSession(open.id) : [],
      interventions: open ? await repos.interventions.listForSession(open.id) : [],
      loaded: true,
    });
  },

  applyChange(change) {
    const current = get().session;
    if (change.session.status === 'ended') {
      if (current?.id === change.session.id) set({ session: null, drinks: [], interventions: [] });
      return;
    }
    if (!current || current.id === change.session.id) {
      set({ session: change.session, drinks: change.drinks, ...(current ? {} : { interventions: [] }) });
    }
  },

  appendInterventions(sessionId, events) {
    if (get().session?.id !== sessionId || events.length === 0) return;
    set({ interventions: [...get().interventions, ...events] });
  },

  async acknowledgeIntervention(id, dismissed) {
    await getServices().interventions.acknowledge(id, dismissed);
    const at = getServices().clock.now();
    set({ interventions: get().interventions.map((i) => (i.id === id ? { ...i, acknowledgedAt: at, dismissed } : i)) });
  },

  start: async () => {
    const services = getServices();
    const startContext = await services.healthService.sessionStartContext().catch(() => undefined);
    return services.sessions.startSession({ origin: 'phone', startContext });
  },
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
