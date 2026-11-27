import { legalDrinkingAge, newId, validateGoals } from '@threshold/core';
import type {
  ConsentRecord,
  ConsentType,
  EligibilityRecord,
  UserGoals,
  UserPreferences,
  ValidationIssue,
} from '@threshold/shared-types';
import { create } from 'zustand';
import { getServices } from '../services/container';
import { CONSENT_VERSION, defaultGoals, defaultPreferences } from '../services/defaults';

export interface AppState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  onboardingCompleted: boolean;
  eligibility: EligibilityRecord | null;
  preferences: UserPreferences;
  goals: UserGoals;
  consents: Partial<Record<ConsentType, ConsentRecord>>;
  encryptedStorage: boolean;

  hydrate(): Promise<void>;
  setError(message: string): void;
  confirmEligibility(country: string, confirmed: boolean): Promise<ValidationIssue[]>;
  savePreferences(patch: Partial<Omit<UserPreferences, 'updatedAt'>>): Promise<void>;
  saveGoals(patch: Partial<Omit<UserGoals, 'updatedAt'>>): Promise<ValidationIssue[]>;
  recordConsent(type: ConsentType, granted: boolean, version?: string): Promise<void>;
  completeOnboarding(): Promise<void>;
  hasConsent(type: ConsentType): boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  status: 'loading',
  error: null,
  onboardingCompleted: false,
  eligibility: null,
  preferences: defaultPreferences(0, null),
  goals: defaultGoals(0),
  consents: {},
  encryptedStorage: false,

  async hydrate() {
    const { repos, clock } = getServices();
    const [profile, prefs, goals, consents] = await Promise.all([
      repos.settings.getProfile(),
      repos.settings.getPreferences(),
      repos.settings.getGoals(),
      repos.settings.latestConsents(),
    ]);
    set({
      status: 'ready',
      onboardingCompleted: profile.onboardingCompletedAt !== null,
      eligibility: profile.eligibility,
      preferences: prefs ?? get().preferences,
      goals: goals ?? defaultGoals(clock.now()),
      consents,
    });
  },

  setError(message) {
    set({ status: 'error', error: message });
  },

  async confirmEligibility(country, confirmed) {
    if (!confirmed) {
      return [{ field: 'eligibility', code: 'not_eligible', message: 'Threshold is only available to adults of legal drinking age.' }];
    }
    const { repos, clock } = getServices();
    const record: EligibilityRecord = {
      confirmedLegalAge: true,
      country: country.toUpperCase(),
      legalDrinkingAge: legalDrinkingAge(country),
      confirmedAt: clock.now(),
    };
    await repos.settings.saveEligibility(record);
    set({ eligibility: record });
    return [];
  },

  async savePreferences(patch) {
    const { repos, clock } = getServices();
    const next: UserPreferences = { ...get().preferences, ...patch, updatedAt: clock.now() };
    await repos.settings.savePreferences(next);
    set({ preferences: next });
  },

  async saveGoals(patch) {
    const issues = validateGoals(patch);
    if (issues.length > 0) return issues;
    const { repos, clock } = getServices();
    const next: UserGoals = { ...get().goals, ...patch, updatedAt: clock.now() };
    await repos.settings.saveGoals(next);
    set({ goals: next });
    return [];
  },

  async recordConsent(type, granted, version = CONSENT_VERSION) {
    const { repos, clock } = getServices();
    const record: ConsentRecord = { id: newId(), type, granted, version, recordedAt: clock.now() };
    await repos.settings.recordConsent(record);
    set({ consents: { ...get().consents, [type]: record } });
  },

  async completeOnboarding() {
    const { repos, clock } = getServices();
    if (!get().hasConsent('health_alcohol_data_processing')) {
      throw new Error('Core data processing consent is required to finish onboarding.');
    }
    // Persist the current preferences/goals so defaults chosen during onboarding are stored.
    await repos.settings.savePreferences({ ...get().preferences, updatedAt: clock.now() });
    await repos.settings.saveGoals({ ...get().goals, updatedAt: clock.now() });
    await repos.settings.completeOnboarding(clock.now());
    set({ onboardingCompleted: true });
  },

  hasConsent(type) {
    const c = get().consents[type];
    return Boolean(c?.granted);
  },
}));
