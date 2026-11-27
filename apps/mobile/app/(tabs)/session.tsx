import { activeDurationMs, formatDuration, sessionRecommendation } from '@threshold/core';
import { router } from 'expo-router';
import { Alert, View } from 'react-native';
import { AppText, Button, Card, Chip, Screen, SectionHeader, Stat } from '../../components/ui';
import { DrinkRow, InterventionCard, PaceCard, QuickLogBar } from '../../features/session/components';
import { PhysiologyCard } from '../../features/session/PhysiologyCard';
import { useLivePace, useQuickLog, useRecentBeverages } from '../../features/session/useSessionData';
import { useNow } from '../../hooks/useNow';
import { formatClock, formatNumber } from '../../lib/format';
import { useSessionStore } from '../../stores/sessionStore';
import { colors, spacing } from '../../theme';

function StartEvening() {
  const start = useSessionStore((s) => s.start);
  return (
    <Screen>
      <AppText variant="title1" accessibilityRole="header">
        Session
      </AppText>
      <Card>
        <AppText color={colors.textSecondary}>
          Start an evening session when you begin drinking. Threshold will track your pace from the drinks you log and remind you
          of your own goals.
        </AppText>
        <Button
          label="Start Evening"
          size="large"
          onPress={async () => {
            const r = await start();
            if (!r.ok) Alert.alert('Couldn’t start a session', r.errors[0]?.message ?? 'Please try again.');
          }}
          testID="start-evening"
        />
      </Card>
      <Button label="Emergency information" variant="danger" onPress={() => router.push('/emergency')} />
    </Screen>
  );
}

export default function SessionTab() {
  const session = useSessionStore((s) => s.session);
  const drinks = useSessionStore((s) => s.drinks);
  const interventions = useSessionStore((s) => s.interventions);
  const { pause, resume, end, acknowledgeIntervention } = useSessionStore.getState();
  const pace = useLivePace();
  const now = useNow(30_000);
  const { def, logBeverage, logWater } = useQuickLog();
  const recent = useRecentBeverages();

  if (!session || !pace) return <StartEvening />;

  const pending = interventions.filter((i) => i.delivered && i.acknowledgedAt === null).slice(-1);
  const visibleDrinks = [...drinks].filter((d) => d.deletedAt === null).sort((a, b) => b.consumedAt - a.consumedAt);
  const water = visibleDrinks.filter((d) => !d.isAlcoholic).length;
  const goal = session.goalSnapshot.maxStandardDrinksPerSession;

  const confirmEnd = () =>
    Alert.alert('End this session?', 'You can still edit drinks afterwards from your history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End session',
        style: 'destructive',
        onPress: async () => {
          const r = await end();
          if (r.ok) router.push({ pathname: '/session/[id]', params: { id: r.value.id } });
        },
      },
    ]);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ gap: spacing.xxs }}>
          <AppText variant="title1" accessibilityRole="header">
            Evening in progress
          </AppText>
          <AppText color={colors.textSecondary}>Started {formatClock(session.startedAt)}</AppText>
        </View>
        {session.status === 'paused' ? <Chip label="Paused" /> : null}
      </View>

      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Stat label="Confirmed" value={formatNumber(pace.totalStandardDrinks)} unit={def.labelPlural} emphasis caption={goal !== null ? `Your goal: ${formatNumber(goal)}` : undefined} />
          <Stat label="Duration" value={formatDuration(activeDurationMs(session, now))} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Stat label="Drinks" value={String(pace.totalDrinks)} caption={pace.totalUnknownStrength > 0 ? `${pace.totalUnknownStrength} of unknown strength` : undefined} />
          <Stat label="Water / NA" value={String(water)} />
        </View>
      </Card>

      {pending.map((p) => (
        <InterventionCard
          key={p.id}
          event={p}
          onAcknowledge={() => void acknowledgeIntervention(p.id, false)}
          onDismiss={() => void acknowledgeIntervention(p.id, true)}
        />
      ))}

      <QuickLogBar
        recent={recent.data ?? []}
        onLog={(b) => void logBeverage(b)}
        onWater={() => void logWater()}
        onMore={() => router.push('/log-drink')}
      />

      <Card tone="info">
        <AppText>{sessionRecommendation(pace, session.goalSnapshot, def)}</AppText>
      </Card>

      <PaceCard pace={pace} def={def} goals={session.goalSnapshot} />
      <PhysiologyCard />

      <SectionHeader title={`Drinks (${visibleDrinks.length})`} />
      <Card>
        {visibleDrinks.length === 0 ? (
          <AppText color={colors.textSecondary}>No drinks logged yet.</AppText>
        ) : (
          visibleDrinks.map((d) => (
            <DrinkRow key={d.id} drink={d} def={def} onPress={() => router.push({ pathname: '/edit-drink/[id]', params: { id: d.id } })} />
          ))
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {session.status === 'paused' ? (
          <Button label="Resume" variant="secondary" onPress={() => void resume()} style={{ flex: 1 }} />
        ) : (
          <Button label="Pause" variant="secondary" onPress={() => void pause()} style={{ flex: 1 }} />
        )}
        <Button label="End Session" variant="secondary" onPress={confirmEnd} style={{ flex: 1 }} testID="end-session" />
      </View>
      <Button label="Emergency information" variant="danger" onPress={() => router.push('/emergency')} />
      <AppText variant="footnote" color={colors.textTertiary}>
        Threshold estimates nothing about blood alcohol and can’t tell whether you’re able to drive. If you’ve been drinking, don’t drive.
      </AppText>
    </Screen>
  );
}
