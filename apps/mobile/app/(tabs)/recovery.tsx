import { HOUR_MS, formatDuration, formatMeasurementValue } from '@threshold/core';
import { router } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card, Chip, ListRow, Screen, SectionHeader, Stat } from '../../components/ui';
import { featureFlags } from '../../config/featureFlags';
import { describeAssociation } from '../../features/insights/observations';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useBaselines, useSleepNights } from '../../hooks/useHealth';
import { useNow } from '../../hooks/useNow';
import { definitionFor, formatDateKey, formatDay, formatNumber } from '../../lib/format';
import { useAppStore } from '../../stores/appStore';
import { colors, spacing } from '../../theme';

export default function Recovery() {
  const prefs = useAppStore((s) => s.preferences);
  const def = definitionFor(prefs);
  const analytics = useAnalytics(8);
  const sleep = useSleepNights(14);
  const baselines = useBaselines();
  const now = useNow(60_000);
  const a = analytics.data;
  const last = a?.sessions.find((s) => s.endedAt !== null);
  const lastCheckin = last ? a?.checkins.find((c) => c.sessionId === last.sessionId) : undefined;
  const nightAfter = last?.endedAt ? (sleep.data ?? []).find((n) => n.sleepStart !== null && n.sleepStart >= (last.endedAt as number) - 6 * HOUR_MS && n.sleepStart <= (last.endedAt as number) + 12 * HOUR_MS) : undefined;
  const sleepBaseline = baselines.data?.baselines.find((b) => b.kind === 'sleep_asleep');
  const obs = a ? describeAssociation(a.sleepVsPeakPace, { exposureHigh: 'more concentrated drinking', outcome: 'sleep quality', higherIsBetter: true }) : null;

  return (
    <Screen>
      <AppText variant="title1" accessibilityRole="header">
        Recovery
      </AppText>

      {last && !lastCheckin && now - (last.endedAt ?? 0) < 48 * HOUR_MS ? (
        <Card title="How are you feeling?" subtitle="A 30-second check-in helps you learn how evenings affect mornings." tone="accent">
          <Button label="Start check-in" onPress={() => router.push({ pathname: '/checkin', params: { sessionId: last.sessionId } })} />
        </Card>
      ) : null}

      {last ? (
        <>
          <SectionHeader title={`Last session · ${formatDay(last.startedAt)}`} />
          <Card onPress={() => router.push({ pathname: '/session/[id]', params: { id: last.sessionId } })} accessibilityLabel="Last session details">
            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <Stat label="Recorded" value={formatNumber(last.standardDrinks)} unit={def.labelPlural} />
              <Stat label="Duration" value={formatDuration(last.activeDurationMs)} />
              <Stat label="Busiest hour" value={formatNumber(last.peakStandardDrinksIn60Min)} />
            </View>
          </Card>
          <Card title="Sleep afterwards" right={nightAfter ? <Chip label="Apple Health" /> : <Chip label="No data" tone="missing" />}>
            {nightAfter ? (
              <View style={{ gap: spacing.xs }}>
                <AppText>
                  {formatMeasurementValue('sleep_asleep', nightAfter.asleepMinutes)} asleep · {nightAfter.interruptions} interruption(s)
                </AppText>
                {sleepBaseline && sleepBaseline.maturity !== 'insufficient' && sleepBaseline.median !== null ? (
                  <AppText variant="footnote" color={colors.textSecondary}>
                    Your typical night: {formatMeasurementValue('sleep_asleep', sleepBaseline.median)}
                  </AppText>
                ) : null}
              </View>
            ) : (
              <AppText color={colors.textSecondary}>No sleep was recorded for this night, or Apple Health isn’t connected.</AppText>
            )}
          </Card>
          {lastCheckin ? (
            <Card title="Your check-in" right={<Chip label="Self-reported" />}>
              <AppText>
                Overall {lastCheckin.overallSeverity ?? '—'}/10 · Sleep quality {lastCheckin.sleepQuality ?? '—'}/10
              </AppText>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <AppText color={colors.textSecondary}>After your first session, your recovery summary appears here.</AppText>
        </Card>
      )}

      <SectionHeader title="Next-day outlook" />
      <Card right={<Chip label="Experimental" tone="experimental" />} title="Personalized prediction">
        <AppText>Insufficient data for personalized prediction.</AppText>
        <AppText variant="footnote" color={colors.textSecondary}>
          {featureFlags.recoveryPrediction
            ? 'A validated model is required before any estimate is shown.'
            : 'Recovery prediction is still experimental and turned off. Threshold won’t show risk percentages until a model has been validated. Your check-ins help build that evidence.'}
        </AppText>
      </Card>

      {obs ? (
        <Card title="Pattern in your records" tone="info">
          <AppText>{obs}</AppText>
        </Card>
      ) : null}

      {(a?.checkins ?? []).length > 0 ? (
        <>
          <SectionHeader title="Recent check-ins" />
          <Card>
            {(a?.checkins ?? []).slice(0, 10).map((c) => (
              <ListRow key={c.id} title={formatDateKey(c.localDate)} subtitle={`Overall ${c.overallSeverity ?? '—'}/10 · Sleep ${c.sleepQuality ?? '—'}/10`} />
            ))}
          </Card>
        </>
      ) : null}
      <Button label="Check in without a session" variant="ghost" onPress={() => router.push('/checkin')} />
    </Screen>
  );
}
