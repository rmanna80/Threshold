import { legalDrinkingAge, supportedEligibilityCountries } from '@threshold/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Card, ChoiceList } from '../../components/ui';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { useAppStore } from '../../stores/appStore';
import { colors, spacing } from '../../theme';

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', MX: 'Mexico', GB: 'United Kingdom', IE: 'Ireland', AU: 'Australia', NZ: 'New Zealand',
  DE: 'Germany', AT: 'Austria', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', SE: 'Sweden',
  NO: 'Norway', FI: 'Finland', DK: 'Denmark', JP: 'Japan', KR: 'South Korea', IN: 'India', BR: 'Brazil', ZA: 'South Africa',
};

export default function Eligibility() {
  const prefs = useAppStore((s) => s.preferences);
  const confirmEligibility = useAppStore((s) => s.confirmEligibility);
  const savePreferences = useAppStore((s) => s.savePreferences);
  const countries = useMemo(() => supportedEligibilityCountries(), []);
  const [country, setCountry] = useState(countries.includes(prefs.emergencyCountry) ? prefs.emergencyCountry : 'US');
  const [showList, setShowList] = useState(false);
  const [confirmed, setConfirmed] = useState<'yes' | 'no' | null>(null);
  const [busy, setBusy] = useState(false);
  const age = legalDrinkingAge(country);

  const onContinue = async () => {
    setBusy(true);
    const issues = await confirmEligibility(country, confirmed === 'yes');
    if (issues.length === 0) {
      await savePreferences({ emergencyCountry: country });
      router.push('/goals');
    }
    setBusy(false);
  };

  return (
    <OnboardingStep
      step="eligibility"
      title="Confirm your age"
      subtitle="Threshold is for adults of legal drinking age. We don’t ask for your date of birth."
      onPrimary={onContinue}
      primaryDisabled={confirmed !== 'yes'}
      primaryLoading={busy}
    >
      <Card title="Where do you live?" subtitle={COUNTRY_NAMES[country] ?? country} right={
        <Pressable onPress={() => setShowList((v) => !v)} accessibilityRole="button" accessibilityLabel="Change country">
          <AppText color={colors.accent}>{showList ? 'Done' : 'Change'}</AppText>
        </Pressable>
      }>
        {showList ? (
          <ChoiceList
            options={countries.map((c) => ({ value: c, label: COUNTRY_NAMES[c] ?? c }))}
            selected={[country]}
            onToggle={(c) => {
              setCountry(c);
              setConfirmed(null);
              setShowList(false);
            }}
          />
        ) : null}
      </Card>
      <ChoiceList
        options={[
          { value: 'yes', label: `I am ${age} or older`, description: `The legal drinking age used for ${COUNTRY_NAMES[country] ?? country}.` },
          { value: 'no', label: `I am under ${age}` },
        ]}
        selected={confirmed ? [confirmed] : []}
        onToggle={(v) => setConfirmed(v as 'yes' | 'no')}
      />
      {confirmed === 'no' ? (
        <Card tone="info">
          <View style={{ gap: spacing.sm }}>
            <AppText>Threshold isn’t available to people under the legal drinking age.</AppText>
            <AppText color={colors.textSecondary}>
              If you have questions about alcohol, a parent, school counsellor or doctor can help. In an emergency, call your local
              emergency number.
            </AppText>
          </View>
        </Card>
      ) : null}
    </OnboardingStep>
  );
}
