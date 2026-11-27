import { formatDuration, summarizeSession, formatMeasurementValue } from '@threshold/core';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card, Chip, Screen, SectionHeader, Stat } from '../../components/ui';
import { DrinkRow } from '../../features/session/components';
import { definitionFor, formatClock, formatDay, formatNumber } from '../../lib/format';
import { getServices } from '../../services/container';
import { useAppStore } from '../../stores/appStore';
import { colors, spacing } from '../../theme';

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prefs = useAppStore((s) => s.preferences);
  const def = definitionFor(prefs);
  const q = useQuery({
    queryKey: ['history', 'session', id],
    queryFn: async () => {
      const s = getServices();
      const data = await s.sessions.getSessionWithDrinks(String(id));
      if (!data) return null;
      return {
        ...data,
        summary: summarizeSession(data.session, data.drinks, s.clock.now(), prefs.dayBoundaryHour),
        interventions: (await s.repos.interventions.listForSession(data.session.id)).filter((i) => i.delivered),
        checkin: await s.repos.checkins.forSession(data.session.id),
      };
    },
  });
  const d = q.data;
  if (!d) {
    return (
      <Screen>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
        <AppText color={colors.textSecondary}>{q.isLoading ? 'Loading…' : 'Session not found.'}</AppText>
      </Screen>
    );
  }
  const { session, drinks, summary, interventions, checkin } = d;
  const ctx = session.startContext;
  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <AppText variant="title1" accessibilityRole="header">
        {formatDay(session.startedAt)}
      </AppText>
      <AppText color={colors.textSecondary}>
        {formatClock(session.startedAt)} – {session.endedAt ? formatClock(session.endedAt) : 'in progress'}
      </AppText>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Stat label="Recorded" value={formatNumber(summary.standardDrinks)} unit={def.labelPlural} emphasis />
          <Stat label="Duration" value={formatDuration(summary.activeDurationMs)} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Stat label="Busiest hour" value={formatNumber(summary.peakStandardDrinksIn60Min)} unit={def.labelPlural} />
          <Stat label="Avg gap" value={summary.meanIntervalMin === null ? '—' : `${Math.round(summary.meanIntervalMin)} min`} />
        </View>
        {summary.goal !== null ? (
          <AppText color={summary.goalMet ? colors.goalComplete : colors.textSecondary}>
            {summary.goalMet ? `Within your goal of ${formatNumber(summary.goal)}` : `Above your goal of ${formatNumber(summary.goal)}`}
          </AppText>
        ) : null}
      </Card>

      {ctx.healthDataAuthorized ? (
        <Card title="Before this session" subtitle="Latest Apple Health readings when the session started">
          {ctx.restingHeartRateBpm ? <AppText>Resting heart rate: {formatMeasurementValue('resting_heart_rate', ctx.restingHeartRateBpm.value)} ({formatDay(ctx.restingHeartRateBpm.measuredAt)})</AppText> : <AppText color={colors.textTertiary}>Resting heart rate: no recent data</AppText>}
          {ctx.hrvSdnnMs ? <AppText>HRV: {formatMeasurementValue('hrv_sdnn', ctx.hrvSdnnMs.value)}</AppText> : <AppText color={colors.textTertiary}>HRV: no recent data</AppText>}
          {ctx.lastNightSleepMinutes ? <AppText>Previous night’s sleep: {formatMeasurementValue('sleep_asleep', ctx.lastNightSleepMinutes.value)}</AppText> : <AppText color={colors.textTertiary}>Previous night’s sleep: no data</AppText>}
        </Card>
      ) : null}

      <SectionHeader title="Drinks" />
      <Card>
        {drinks.length === 0 ? (
          <AppText color={colors.textSecondary}>No drinks recorded.</AppText>
        ) : (
          drinks.map((x) => <DrinkRow key={x.id} drink={x} def={def} onPress={() => router.push({ pathname: '/edit-drink/[id]', params: { id: x.id } })} />)
        )}
      </Card>

      {interventions.length > 0 ? (
        <>
          <SectionHeader title="Reminders during this session" />
          <Card>
            {interventions.map((i) => (
              <View key={i.id} style={{ gap: spacing.xxs, paddingVertical: spacing.xs }}>
                <AppText variant="callout">
                  {formatClock(i.triggeredAt)} · {i.title}
                </AppText>
                <AppText variant="footnote" color={colors.textSecondary}>
                  {i.body}
                </AppText>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Next day" />
      {checkin ? (
        <Card title="Morning check-in" right={<Chip label="Self-reported" />}>
          {checkin.overallSeverity !== null ? <AppText>Overall: {checkin.overallSeverity}/10</AppText> : null}
          {checkin.sleepQuality !== null ? <AppText>Sleep quality: {checkin.sleepQuality}/10</AppText> : null}
          {checkin.headache !== null ? <AppText>Headache: {checkin.headache}/10</AppText> : null}
        </Card>
      ) : session.status === 'ended' ? (
        <Button label="Add a morning check-in" variant="secondary" onPress={() => router.push({ pathname: '/checkin', params: { sessionId: session.id } })} />
      ) : null}
    </Screen>
  );
}
