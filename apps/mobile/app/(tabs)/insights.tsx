import { formatDuration } from '@threshold/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BarChart, CalendarHeatmap } from '../../components/charts';
import { AppText, Card, Chip, ListRow, Screen, SectionHeader, SegmentedControl, Stat } from '../../components/ui';
import { describeAssociation } from '../../features/insights/observations';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useMeasurementSeries, useSleepNights } from '../../hooks/useHealth';
import { definitionFor, formatDateKey, formatDay, formatNumber } from '../../lib/format';
import { useAppStore } from '../../stores/appStore';
import { colors, spacing } from '../../theme';

type Range = '4' | '12' | '26';

export default function Insights() {
  const prefs = useAppStore((s) => s.preferences);
  const goals = useAppStore((s) => s.goals);
  const [range, setRange] = useState<Range>('12');
  const q = useAnalytics(Number(range));
  const sleep = useSleepNights(Number(range) * 7);
  const rhr = useMeasurementSeries('resting_heart_rate', Number(range) * 7);
  const def = definitionFor(prefs);
  const a = q.data;

  if (!a) {
    return (
      <Screen>
        <AppText variant="title1">Insights</AppText>
        <AppText color={colors.textSecondary}>Loading your history…</AppText>
      </Screen>
    );
  }

  const ended = a.sessions.filter((s) => s.endedAt !== null && s.drinks > 0);
  const avgPerSession = ended.length ? ended.reduce((s, x) => s + x.standardDrinks, 0) / ended.length : null;
  const totalDays = a.weeks.reduce((s, w) => s + w.elapsedDays, 0);
  const afDays = a.weeks.reduce((s, w) => s + w.alcoholFreeDays, 0);
  const sleepObs = describeAssociation(a.sleepVsPeakPace, { exposureHigh: 'more concentrated drinking', outcome: 'sleep quality', higherIsBetter: true });
  const sevObs = describeAssociation(a.severityVsTotal, { exposureHigh: 'more recorded drinks', outcome: 'next-day symptom severity', higherIsBetter: false });
  const nights = (sleep.data ?? []).filter((n) => n.asleepMinutes > 0).slice(-14);

  return (
    <Screen>
      <AppText variant="title1" accessibilityRole="header">
        Insights
      </AppText>
      <SegmentedControl
        accessibilityLabel="Time range"
        options={[
          { value: '4', label: '4 weeks' },
          { value: '12', label: '12 weeks' },
          { value: '26', label: '6 months' },
        ]}
        value={range}
        onChange={setRange}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <Chip label="Recorded by you" tone="observed" />
        {a.estimatedDrinks > 0 ? <Chip label={`${a.estimatedDrinks} estimated`} tone="estimated" /> : null}
        {a.unknownStrengthDrinks > 0 ? <Chip label={`${a.unknownStrengthDrinks} unknown strength`} tone="missing" /> : null}
      </View>

      <Card tone={goals.alcoholFreeDaysPerWeek !== null && a.adherence.filter((w) => w.alcoholFreeGoalMet).length > 0 ? 'goal' : 'default'}>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Stat label="Alcohol-free days" value={String(afDays)} caption={`of ${totalDays}`} />
          <Stat label="Sessions" value={String(ended.length)} />
          <Stat label="Avg / session" value={avgPerSession === null ? '—' : formatNumber(avgPerSession)} unit={def.labelPlural} />
        </View>
      </Card>

      <SectionHeader title="Weekly consumption" />
      <Card>
        <BarChart
          data={a.weeks.map((w, i) => ({ label: formatDateKey(w.from).split(',')[1]?.trim() ?? w.from, value: w.standardDrinks, highlight: i === a.weeks.length - 1 }))}
          unit={def.labelPlural}
          referenceLine={goals.maxStandardDrinksPerWeek !== null ? { value: goals.maxStandardDrinksPerWeek, label: 'your weekly goal' } : null}
          accessibilityLabel="Recorded standard drinks per week"
        />
      </Card>

      <SectionHeader title="Alcohol-free days per week" />
      <Card>
        <BarChart
          data={a.weeks.map((w, i) => ({ label: formatDateKey(w.from).split(',')[1]?.trim() ?? w.from, value: w.alcoholFreeDays, highlight: i === a.weeks.length - 1 }))}
          unit="days"
          color={colors.goalComplete}
          referenceLine={goals.alcoholFreeDaysPerWeek !== null ? { value: goals.alcoholFreeDaysPerWeek, label: 'your alcohol-free goal' } : null}
          accessibilityLabel="Alcohol-free days per week"
          formatValue={(v) => String(v)}
        />
      </Card>

      <SectionHeader title="Calendar" />
      <Card>
        <CalendarHeatmap cells={a.heatmap} accessibilityLabel="Calendar of recorded drinking days" />
      </Card>

      <SectionHeader title="Pace" />
      <Card title="Busiest hour per session" subtitle={`${def.labelPlural} in any 60 minutes`}>
        <BarChart data={a.paceHistogram.map((b) => ({ label: b.label.replace(' per hour', ''), value: b.count }))} unit="sessions" accessibilityLabel="Distribution of peak hourly pace" formatValue={(v) => String(v)} height={120} />
      </Card>
      <Card title="Time between drinks">
        <BarChart data={a.intervalHistogram.map((b) => ({ label: b.label.replace(' min', ''), value: b.count }))} unit="intervals" accessibilityLabel="Distribution of minutes between drinks" formatValue={(v) => String(v)} height={120} />
      </Card>

      {nights.length > 0 ? (
        <>
          <SectionHeader title="Sleep (Apple Health)" />
          <Card>
            <BarChart data={nights.map((n) => ({ label: formatDateKey(n.night).split(' ')[0] ?? '', value: n.asleepMinutes / 60 }))} unit="hours asleep" color={colors.info} accessibilityLabel="Hours asleep per night" height={120} />
            <AppText variant="footnote" color={colors.textTertiary}>
              From sleep recorded by your devices. Nights without data are not shown.
            </AppText>
          </Card>
        </>
      ) : null}

      {(rhr.data ?? []).length > 0 ? (
        <Card title="Resting heart rate (Apple Health)">
          <BarChart data={(rhr.data ?? []).slice(-14).map((m) => ({ label: formatDay(m.startAt).split(' ')[0] ?? '', value: m.value }))} unit="bpm" color={colors.info} accessibilityLabel="Daily resting heart rate" formatValue={(v) => String(Math.round(v))} height={110} />
        </Card>
      ) : null}

      <SectionHeader title="Patterns in your records" />
      <Card tone="info">
        {sleepObs || sevObs ? (
          <View style={{ gap: spacing.sm }}>
            {sleepObs ? <AppText>{sleepObs}</AppText> : null}
            {sevObs ? <AppText>{sevObs}</AppText> : null}
          </View>
        ) : (
          <AppText color={colors.textSecondary}>
            Not enough sessions with morning check-ins yet. Patterns appear after at least 10 check-ins linked to sessions.
          </AppText>
        )}
      </Card>

      <SectionHeader title="Sessions" />
      <Card>
        {a.sessions.length === 0 ? (
          <AppText color={colors.textSecondary}>No sessions recorded in this period.</AppText>
        ) : (
          a.sessions.slice(0, 30).map((s) => (
            <ListRow
              key={s.sessionId}
              title={formatDay(s.startedAt)}
              subtitle={`${formatNumber(s.standardDrinks)} ${def.labelPlural} · ${s.drinks} drinks · ${formatDuration(s.activeDurationMs)}${s.endedAt === null ? ' · in progress' : ''}`}
              onPress={() => router.push({ pathname: '/session/[id]', params: { id: s.sessionId } })}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
