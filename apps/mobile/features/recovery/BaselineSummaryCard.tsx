import { formatMeasurementValue } from '@threshold/core';
import type { BaselineSummary } from '@threshold/shared-types';
import { router } from 'expo-router';
import { View } from 'react-native';
import { AppText, Card, Chip } from '../../components/ui';
import { useBaselines } from '../../hooks/useHealth';
import { colors, spacing } from '../../theme';

const LABEL: Record<string, string> = {
  resting_heart_rate: 'Resting heart rate',
  hrv_sdnn: 'HRV (SDNN)',
  sleep_asleep: 'Sleep',
  respiratory_rate: 'Sleeping respiratory rate',
};

function MaturityChip({ b }: { b: BaselineSummary }) {
  if (b.maturity === 'established') return <Chip label={`${b.distinctDays} days of data`} tone="observed" />;
  if (b.maturity === 'developing') return <Chip label="Baseline developing" tone="estimated" />;
  return <Chip label="Not enough data yet" tone="missing" />;
}

/** Personal baselines with explicit data-sufficiency labels; hidden entirely when Health is off. */
export function BaselineSummaryCard() {
  const q = useBaselines();
  if (!q.data) return null;
  if (!q.data.available) {
    return (
      <Card title="Your baselines" subtitle="Apple Health is not connected" onPress={() => router.push('/settings/privacy')} accessibilityHint="Opens permission settings">
        <AppText variant="footnote" color={colors.textSecondary}>
          Connect Apple Health to see your typical resting heart rate, HRV and sleep. Threshold works fully without it.
        </AppText>
      </Card>
    );
  }
  const shown = q.data.baselines.filter((b) => LABEL[b.kind]);
  return (
    <Card title="Your baselines" subtitle="Typical values from the last 28 days, excluding drinking evenings">
      {shown.map((b) => (
        <View key={`${b.kind}-${b.context}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1, gap: spacing.xxs }}>
            <AppText variant="callout">{LABEL[b.kind]}</AppText>
            <MaturityChip b={b} />
          </View>
          <AppText variant="headline" color={b.maturity === 'insufficient' ? colors.textTertiary : colors.textPrimary}>
            {b.maturity === 'insufficient' || b.median === null ? '—' : formatMeasurementValue(b.kind, b.median)}
          </AppText>
        </View>
      ))}
      <AppText variant="footnote" color={colors.textTertiary}>
        Baselines describe your own history. They are not medical reference ranges.
      </AppText>
    </Card>
  );
}
