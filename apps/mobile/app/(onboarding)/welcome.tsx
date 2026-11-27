import { router } from 'expo-router';
import { View } from 'react-native';
import { AppText, Card } from '../../components/ui';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { colors, spacing } from '../../theme';

export default function Welcome() {
  return (
    <OnboardingStep
      step="welcome"
      title="Welcome to Threshold"
      subtitle="A private companion for drinking less, pacing yourself, and understanding how alcohol affects your sleep and recovery."
      primaryLabel="Get started"
      onPrimary={() => router.push('/eligibility')}
    >
      <Card title="Monitor. Understand. Intervene. Recover. Learn.">
        <AppText color={colors.textSecondary}>
          Log drinks in a tap, get gentle pacing reminders during the evening, check in the next morning, and see patterns over
          time.
        </AppText>
      </Card>
      <Card title="What Threshold is not" tone="info">
        <View style={{ gap: spacing.sm }}>
          <AppText color={colors.textSecondary}>• It does not measure blood alcohol and cannot tell you whether you are sober.</AppText>
          <AppText color={colors.textSecondary}>• It can never tell you whether it is safe to drive. If you have been drinking, don’t drive.</AppText>
          <AppText color={colors.textSecondary}>• It does not define a safe amount to drink or guarantee you won’t feel unwell.</AppText>
          <AppText color={colors.textSecondary}>• It is not medical care. If someone may have alcohol poisoning, call emergency services.</AppText>
        </View>
      </Card>
      <AppText variant="footnote" color={colors.textTertiary}>
        Your data stays on this device unless you choose to turn on cloud sync.
      </AppText>
    </OnboardingStep>
  );
}
