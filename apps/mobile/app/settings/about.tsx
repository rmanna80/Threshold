import { STANDARD_DRINK_DEFINITIONS } from '@threshold/core';
import { AppText, Card, Chip, Screen, SectionHeader } from '../../components/ui';
import { featureFlags } from '../../config/featureFlags';
import { colors } from '../../theme';

export default function About() {
  return (
    <Screen edges={[]}>
      <Card title="Threshold" subtitle="Comeback Technologies LLC">
        <AppText color={colors.textSecondary}>
          Threshold helps you drink less, pace yourself, and understand next-day recovery. It is a wellness tool, not a medical device.
        </AppText>
      </Card>
      <SectionHeader title="Important limitations" />
      <Card>
        <AppText color={colors.textSecondary}>• Threshold does not and cannot measure blood alcohol concentration.</AppText>
        <AppText color={colors.textSecondary}>• It never determines whether you are sober or able to drive. Don’t drive after drinking.</AppText>
        <AppText color={colors.textSecondary}>• No pace or amount shown in Threshold is a safe limit. Personal goals are your own choices.</AppText>
        <AppText color={colors.textSecondary}>• Apple Watch readings are intermittent and can’t detect or rule out alcohol poisoning.</AppText>
        <AppText color={colors.textSecondary}>• Patterns in your history are correlations, not causes.</AppText>
      </Card>
      <SectionHeader title="How standard drinks are calculated" />
      <Card>
        <AppText color={colors.textSecondary}>Pure alcohol (g) = volume (mL) × ABV × 0.789 g/mL. Standard drinks = grams ÷ your region’s definition.</AppText>
        {Object.values(STANDARD_DRINK_DEFINITIONS).map((d) => (
          <AppText key={d.region} variant="footnote" color={colors.textTertiary}>
            {d.region}: {d.gramsEthanol} g — {d.source}
          </AppText>
        ))}
      </Card>
      <SectionHeader title="Experimental features" />
      <Card>
        <Chip label={`Gesture-assisted logging: ${featureFlags.gestureAssistedLogging ? 'on' : 'off (requires validation)'}`} tone="experimental" />
        <Chip label={`Recovery prediction: ${featureFlags.recoveryPrediction ? 'on' : 'off (requires validation)'}`} tone="experimental" />
      </Card>
    </Screen>
  );
}
