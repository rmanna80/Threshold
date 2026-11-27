import { formatAge, formatMeasurementValue } from '@threshold/core';
import { useQuery } from '@tanstack/react-query';
import { AppText, Card, Chip } from '../../components/ui';
import { useNow } from '../../hooks/useNow';
import { getServices } from '../../services/container';
import { colors } from '../../theme';

/**
 * Most recent heart-rate reading from Apple Health, always with its age. Apple Watch records
 * heart rate intermittently on most models, so this is labelled as a past reading, never "live".
 */
export function PhysiologyCard() {
  const now = useNow(60_000);
  const q = useQuery({
    queryKey: ['health', 'hr-summary'],
    queryFn: () => getServices().healthService.heartRateSummary(),
    refetchInterval: 120_000,
  });
  if (q.data === undefined) return null;
  if (q.data === null) {
    return (
      <Card title="Heart rate" right={<Chip label="No recent data" tone="missing" />}>
        <AppText variant="footnote" color={colors.textSecondary}>
          No heart-rate reading from the last few hours is available. This is normal if Apple Health isn’t connected or your watch hasn’t recorded one recently.
        </AppText>
      </Card>
    );
  }
  const d = q.data;
  return (
    <Card title="Heart rate" subtitle={`Recorded ${formatAge(d.measuredAt, now)}`} right={<Chip label={d.context === 'active' ? 'While active' : 'Apple Health'} />}>
      <AppText variant="title2">{formatMeasurementValue('heart_rate', d.value)}</AppText>
      <AppText variant="footnote" color={colors.textSecondary}>
        {d.description}
      </AppText>
      <AppText variant="caption" color={colors.textTertiary}>
        Heart rate cannot show how much alcohol is in your body or whether you are OK.
      </AppText>
    </Card>
  );
}
