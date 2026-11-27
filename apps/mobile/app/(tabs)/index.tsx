import { activeDurationMs, evaluateGoal, formatDuration, weekdayIndex } from '@threshold/core';
import { router } from 'expo-router';
import { Alert, View } from 'react-native';
import { BarChart } from '../../components/charts';
import { AppText, Button, Card, Screen, SectionHeader, Stat } from '../../components/ui';
import { describeAssociation } from '../../features/insights/observations';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useNow } from '../../hooks/useNow';
import { definitionFor, formatNumber } from '../../lib/format';
import { useAppStore } from '../../stores/appStore';
import { useSessionStore } from '../../stores/sessionStore';
import { colors, spacing } from '../../theme';
import { BaselineSummaryCard } from '../../features/recovery/BaselineSummaryCard';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function Today() {
  const prefs = useAppStore((s) => s.preferences);
  const goals = useAppStore((s) => s.goals);
  const session = useSessionStore((s) => s.session);
  const drinks = useSessionStore((s) => s.drinks);
  const start = useSessionStore((s) => s.start);
  const analytics = useAnalytics(8);
  const now = useNow(60_000);
  const def = definitionFor(prefs);
  const a = analytics.data;

  const weekly = a ? evaluateGoal(a.currentWeek.standardDrinks, goals.maxStandardDrinksPerWeek) : null;
  const afGoal = goals.alcoholFreeDaysPerWeek;
  const afMet = a && afGoal !== null ? a.currentWeek.alcoholFreeDays >= afGoal : false;
  const lastSession = a?.sessions.find((s) => s.endedAt !== null);
  const needsCheckin = lastSession && now - (lastSession.endedAt ?? 0) < 36 * 3_600_000 && !a?.checkins.some((c) => c.sessionId === lastSession.sessionId);
  const observation = a ? describeAssociation(a.sleepVsPeakPace, { exposureHigh: 'more concentrated drinking', outcome: 'sleep quality', higherIsBetter: true }) : null;

  return (
    <Screen>
      <AppText variant="title1" accessibilityRole="header">
        Today
      </AppText>

      {session ? (
        <Card
          title="Evening in progress"
          subtitle={`${drinks.filter((d) => d.deletedAt === null && d.isAlcoholic).length} drinks · ${formatDuration(activeDurationMs(session, now))}`}
          onPress={() => router.push('/session')}
          tone="accent"
          accessibilityHint="Opens the active session"
        />
      ) : (
        <Button
          label="Start Evening"
          size="large"
          onPress={async () => {
            const r = await start();
            if (r.ok) router.push('/session');
            else Alert.alert('Couldn’t start a session', r.errors[0]?.message ?? '');
          }}
          testID="today-start-evening"
        />
      )}

      {needsCheckin && lastSession ? (
        <Card
          title="Morning check-in"
          subtitle="How are you feeling after your last session? Takes under 30 seconds."
          onPress={() => router.push({ pathname: '/checkin', params: { sessionId: lastSession.sessionId } })}
        />
      ) : null}

      <SectionHeader title="This week" />
      <Card tone={afMet ? 'goal' : 'default'}>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Stat
            label="Alcohol-free days"
            value={a ? String(a.currentWeek.alcoholFreeDays) : '—'}
            caption={afGoal !== null ? (afMet ? `Goal of ${afGoal} reached` : `Your goal: ${afGoal}`) : `of ${a?.currentWeek.elapsedDays ?? 0} so far`}
          />
          <Stat
            label="Recorded"
            value={a ? formatNumber(a.currentWeek.standardDrinks) : '—'}
            unit={def.labelPlural}
            caption={weekly?.goal !== null && weekly?.goal !== undefined ? `Your weekly goal: ${formatNumber(weekly.goal)}` : undefined}
          />
        </View>
        {a ? (
          <BarChart
            data={a.last7Days.map((d) => ({ label: DAY_LABELS[weekdayIndex(d.date)] ?? '', value: d.standardDrinks, highlight: d.date === a.today }))}
            unit={def.labelPlural}
            accessibilityLabel="Recorded standard drinks for the last 7 days"
            height={110}
          />
        ) : null}
        {a && a.unknownStrengthDrinks > 0 ? (
          <AppText variant="footnote" color={colors.estimated}>
            Includes {a.unknownStrengthDrinks} drink(s) of unknown strength not counted in totals.
          </AppText>
        ) : null}
      </Card>

      {goals.objectives.length > 0 || goals.maxStandardDrinksPerSession !== null ? (
        <Card title="Your goals" onPress={() => router.push('/settings/goals')} accessibilityHint="Edit your goals">
          {goals.maxStandardDrinksPerSession !== null ? (
            <AppText color={colors.textSecondary}>
              Up to {formatNumber(goals.maxStandardDrinksPerSession)} {def.labelPlural} per evening
            </AppText>
          ) : null}
          {goals.maxStandardDrinksPerWeek !== null ? (
            <AppText color={colors.textSecondary}>
              Up to {formatNumber(goals.maxStandardDrinksPerWeek)} {def.labelPlural} per week
            </AppText>
          ) : null}
          {afGoal !== null ? <AppText color={colors.textSecondary}>{afGoal} alcohol-free days per week</AppText> : null}
          {goals.paceGoalMinutesBetweenDrinks !== null ? (
            <AppText color={colors.textSecondary}>About {goals.paceGoalMinutesBetweenDrinks} min between drinks</AppText>
          ) : null}
        </Card>
      ) : null}

      <BaselineSummaryCard />

      {observation ? (
        <Card title="Observation" tone="info">
          <AppText>{observation}</AppText>
        </Card>
      ) : null}
    </Screen>
  );
}
