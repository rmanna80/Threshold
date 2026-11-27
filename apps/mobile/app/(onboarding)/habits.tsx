import { STANDARD_DRINK_DEFINITIONS } from '@threshold/core';
import type { DrinkingFrequency, NotificationFrequency, StandardDrinkRegion } from '@threshold/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { AppText, Card, ChoiceList, SectionHeader, SegmentedControl, TextField } from '../../components/ui';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

const FREQUENCY: { value: DrinkingFrequency; label: string }[] = [
  { value: 'rarely', label: 'Rarely' },
  { value: 'monthly', label: 'A few times a month' },
  { value: 'weekly', label: 'About once a week' },
  { value: 'several_per_week', label: 'Several times a week' },
  { value: 'daily', label: 'Most days' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const REGION_LABEL: Record<Exclude<StandardDrinkRegion, 'CUSTOM'>, string> = {
  US: 'United States',
  UK: 'United Kingdom',
  AU: 'Australia',
  NZ: 'New Zealand',
  CA: 'Canada',
  IE: 'Ireland',
  AT: 'Austria',
};

function parseOptional(text: string, min: number, max: number): number | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return 'invalid';
  return n;
}

export default function Habits() {
  const prefs = useAppStore((s) => s.preferences);
  const savePreferences = useAppStore((s) => s.savePreferences);
  const [frequency, setFrequency] = useState<DrinkingFrequency | null>(prefs.drinkingFrequency);
  const [region, setRegion] = useState<StandardDrinkRegion>(prefs.standardDrinkRegion);
  const [notif, setNotif] = useState<NotificationFrequency>(prefs.notificationFrequency);
  const [watch, setWatch] = useState<'yes' | 'no' | null>(prefs.hasAppleWatch === null ? null : prefs.hasAppleWatch ? 'yes' : 'no');
  const [height, setHeight] = useState(prefs.heightCm ? String(prefs.heightCm) : '');
  const [weight, setWeight] = useState(prefs.weightKg ? String(prefs.weightKg) : '');
  const [error, setError] = useState<string | null>(null);

  const onContinue = async () => {
    const h = parseOptional(height, 50, 272);
    const w = parseOptional(weight, 20, 400);
    if (h === 'invalid' || w === 'invalid') {
      setError('Please check height (50–272 cm) and weight (20–400 kg), or leave them blank.');
      return;
    }
    await savePreferences({
      drinkingFrequency: frequency,
      standardDrinkRegion: region,
      notificationFrequency: notif,
      hasAppleWatch: watch === null ? null : watch === 'yes',
      heightCm: h,
      weightKg: w,
    });
    router.push('/permissions');
  };

  return (
    <OnboardingStep step="habits" title="A little context" subtitle="This tailors reminders and units. Everything here is optional except your standard drink definition." onPrimary={onContinue}>
      <SectionHeader title="How often do you usually drink?" />
      <ChoiceList options={FREQUENCY} selected={frequency ? [frequency] : []} onToggle={setFrequency} />

      <SectionHeader title="Standard drink definition" />
      <Card>
        <AppText variant="footnote" color={colors.textSecondary}>
          Countries define a “standard drink” differently. Choose the one you want totals expressed in.
        </AppText>
        <ChoiceList
          options={(Object.keys(REGION_LABEL) as Exclude<StandardDrinkRegion, 'CUSTOM'>[]).map((r) => ({
            value: r,
            label: REGION_LABEL[r],
            description: `${STANDARD_DRINK_DEFINITIONS[r].gramsEthanol} g of pure alcohol per ${STANDARD_DRINK_DEFINITIONS[r].label}`,
          }))}
          selected={[region]}
          onToggle={setRegion}
        />
      </Card>

      <SectionHeader title="Reminder frequency" />
      <SegmentedControl
        accessibilityLabel="Reminder frequency"
        options={[
          { value: 'minimal', label: 'Minimal' },
          { value: 'standard', label: 'Standard' },
          { value: 'frequent', label: 'Frequent' },
        ]}
        value={notif}
        onChange={setNotif}
      />

      <SectionHeader title="Do you wear an Apple Watch?" />
      <SegmentedControl
        accessibilityLabel="Apple Watch availability"
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
        value={watch}
        onChange={setWatch}
      />

      <SectionHeader title="Body measurements (optional)" />
      <Card>
        <AppText variant="footnote" color={colors.textSecondary}>
          Threshold does not use these to estimate blood alcohol. They are stored only on this device and are used solely as optional
          context in your own exported data and future validated research models you opt into. Leave blank to skip.
        </AppText>
        <TextField label="Height (cm)" keyboardType="decimal-pad" value={height} onChangeText={setHeight} placeholder="Optional" />
        <TextField label="Weight (kg)" keyboardType="decimal-pad" value={weight} onChangeText={setWeight} placeholder="Optional" />
      </Card>
      {error ? <AppText color={colors.safety}>{error}</AppText> : null}
    </OnboardingStep>
  );
}
