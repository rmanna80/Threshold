import { DEFAULT_GOALS } from '@threshold/core';
import type { StandardDrinkRegion, UserGoals, UserPreferences } from '@threshold/shared-types';

const REGION_BY_COUNTRY: Record<string, StandardDrinkRegion> = {
  US: 'US',
  GB: 'UK',
  AU: 'AU',
  NZ: 'NZ',
  CA: 'CA',
  IE: 'IE',
  AT: 'AT',
};

/** Defaults derived from the device region; the user confirms/changes them during onboarding. */
export function defaultPreferences(now: number, countryCode: string | null): UserPreferences {
  const country = (countryCode ?? 'US').toUpperCase();
  return {
    notificationFrequency: 'standard',
    quietMode: false,
    standardDrinkRegion: REGION_BY_COUNTRY[country] ?? 'US',
    customStandardDrinkGrams: null,
    unitSystem: country === 'US' ? 'us_customary' : 'metric',
    drinkingFrequency: null,
    hasAppleWatch: null,
    cloudSyncEnabled: false,
    researchParticipation: false,
    crashReportingEnabled: false,
    automaticDetectionEnabled: false,
    emergencyCountry: /^[A-Z]{2}$/.test(country) ? country : 'US',
    dayBoundaryHour: 5,
    heightCm: null,
    weightKg: null,
    updatedAt: now,
  };
}

export function defaultGoals(now: number): UserGoals {
  return { ...DEFAULT_GOALS, objectives: [], updatedAt: now };
}

/** Bump when consent copy changes materially; users are re-prompted for the new version. */
export const CONSENT_VERSION = '2026-11-1';
