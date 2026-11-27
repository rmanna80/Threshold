import { ALCOHOL_POISONING_SIGNS, EMERGENCY_ACTIONS, MONITORING_DISCLAIMER, emergencyNumberFor } from '@threshold/core';
import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { AppText, Button, Card, Screen } from '../components/ui';
import { useAppStore } from '../stores/appStore';
import { colors, spacing } from '../theme';

/**
 * Educational emergency information. Always available, always free, never gated by a
 * subscription, and independent of any sensor or model output.
 */
export default function Emergency() {
  const country = useAppStore((s) => s.preferences.emergencyCountry);
  const number = emergencyNumberFor(country);
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="title1" accessibilityRole="header" color={colors.safety}>
          Emergency information
        </AppText>
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>

      <Card tone="safety" title={`Call ${number.primary}`} subtitle={`${number.name} — ${number.notes}`}>
        <AppText>If you think someone may have alcohol poisoning, call emergency services now. Don’t wait for all the signs.</AppText>
        <Button
          label={`Call ${number.primary}`}
          variant="danger"
          size="large"
          onPress={() => void Linking.openURL(`tel:${number.primary}`)}
          accessibilityHint="Opens the phone dialer"
          haptic={false}
        />
      </Card>

      <Card title="Signs of alcohol poisoning">
        <View style={{ gap: spacing.sm }} accessibilityRole="list">
          {ALCOHOL_POISONING_SIGNS.map((s) => (
            <AppText key={s}>• {s}</AppText>
          ))}
        </View>
      </Card>

      <Card title="What to do">
        <View style={{ gap: spacing.sm }}>
          {EMERGENCY_ACTIONS.map((a) => (
            <AppText key={a}>• {a}</AppText>
          ))}
        </View>
      </Card>

      <Card tone="info">
        <AppText variant="callout">{MONITORING_DISCLAIMER}</AppText>
      </Card>
      <AppText variant="footnote" color={colors.textTertiary}>
        Source: U.S. National Institute on Alcohol Abuse and Alcoholism (NIAAA), “Understanding the Dangers of Alcohol Overdose”.
        This is educational information, not medical advice. Change the emergency number’s country in Profile → Preferences.
      </AppText>
    </Screen>
  );
}
