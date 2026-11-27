import { useAppStore } from '../stores/appStore';
import { createHarness } from './support/harness';

describe('app store (onboarding & settings)', () => {
  it('requires eligibility confirmation and enforces the legal age floor', async () => {
    await createHarness();
    await useAppStore.getState().hydrate();
    const denied = await useAppStore.getState().confirmEligibility('US', false);
    expect(denied[0]?.code).toBe('not_eligible');
    expect(await useAppStore.getState().confirmEligibility('US', true)).toEqual([]);
    expect(useAppStore.getState().eligibility?.legalDrinkingAge).toBe(21);
  });

  it('cannot complete onboarding without core data-processing consent', async () => {
    await createHarness();
    await useAppStore.getState().hydrate();
    await expect(useAppStore.getState().completeOnboarding()).rejects.toThrow(/consent/);
    await useAppStore.getState().recordConsent('health_alcohol_data_processing', true);
    await useAppStore.getState().completeOnboarding();
    expect(useAppStore.getState().onboardingCompleted).toBe(true);
  });

  it('validates and persists goals and preferences across hydration', async () => {
    const h = await createHarness();
    await useAppStore.getState().hydrate();
    expect(await useAppStore.getState().saveGoals({ alcoholFreeDaysPerWeek: 9 })).toHaveLength(1);
    expect(await useAppStore.getState().saveGoals({ alcoholFreeDaysPerWeek: 3, maxStandardDrinksPerSession: 2.5 })).toEqual([]);
    await useAppStore.getState().savePreferences({ notificationFrequency: 'minimal' });
    const stored = await h.services.repos.settings.getGoals();
    expect(stored?.alcoholFreeDaysPerWeek).toBe(3);
    expect((await h.services.repos.settings.getPreferences())?.notificationFrequency).toBe('minimal');
  });

  it('records consent revocation as a new entry', async () => {
    const h = await createHarness();
    await useAppStore.getState().hydrate();
    await useAppStore.getState().recordConsent('cloud_sync', true);
    await useAppStore.getState().recordConsent('cloud_sync', false);
    expect(useAppStore.getState().hasConsent('cloud_sync')).toBe(false);
    expect((await h.services.repos.settings.consentHistory()).filter((c) => c.type === 'cloud_sync')).toHaveLength(2);
  });
});
