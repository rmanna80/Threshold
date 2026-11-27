import { localDateKey, newId } from '@threshold/core';
import type { RecoveryCheckin } from '@threshold/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, ScoreSelector, Screen, SegmentedControl } from '../components/ui';
import { getServices } from '../services/container';
import { colors, spacing } from '../theme';

type Scores = Pick<RecoveryCheckin, 'overallSeverity' | 'sleepQuality' | 'headache' | 'fatigue' | 'nausea' | 'dizziness' | 'mentalClarity' | 'functionalImpairment'>;

/** Morning check-in: one primary question plus optional detail; every item can be skipped. */
export default function Checkin() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const qc = useQueryClient();
  const [scores, setScores] = useState<Scores>({
    overallSeverity: null,
    sleepQuality: null,
    headache: null,
    fatigue: null,
    nausea: null,
    dizziness: null,
    mentalClarity: null,
    functionalImpairment: null,
  });
  const [ate, setAte] = useState<'yes' | 'no' | null>(null);
  const [hydration, setHydration] = useState<RecoveryCheckin['hydrationReported']>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Scores) => (v: number | null) => setScores((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const { repos, clock, outbox, reminders } = getServices();
      const now = clock.now();
      const checkin: RecoveryCheckin = {
        id: newId(),
        sessionId: sessionId ? String(sessionId) : null,
        localDate: localDateKey(now, clock.tzOffsetMin(now), 0),
        completedAt: now,
        ...scores,
        ateBeforeDrinking: ate === null ? null : ate === 'yes',
        hydrationReported: hydration,
        revision: 1,
        updatedAt: now,
        deletedAt: null,
      };
      await repos.checkins.upsert(checkin);
      await outbox.record('recovery_checkin', checkin, now);
      await reminders.onCheckinSaved(checkin.sessionId);
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Not now" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button label="Save" onPress={save} loading={busy} style={{ flex: 2 }} />
        </View>
      }
    >
      <AppText variant="title1" accessibilityRole="header">
        Morning check-in
      </AppText>
      <AppText color={colors.textSecondary}>Answer as many as you like — everything is optional.</AppText>
      <Card>
        <ScoreSelector label="How rough do you feel overall?" lowLabel="fine" highLabel="very unwell" value={scores.overallSeverity} onChange={set('overallSeverity')} />
        <ScoreSelector label="Sleep quality" lowLabel="very poor" highLabel="excellent" value={scores.sleepQuality} onChange={set('sleepQuality')} />
      </Card>
      {more ? (
        <Card>
          <ScoreSelector label="Headache" lowLabel="none" highLabel="severe" value={scores.headache} onChange={set('headache')} />
          <ScoreSelector label="Fatigue" lowLabel="none" highLabel="severe" value={scores.fatigue} onChange={set('fatigue')} />
          <ScoreSelector label="Nausea" lowLabel="none" highLabel="severe" value={scores.nausea} onChange={set('nausea')} />
          <ScoreSelector label="Dizziness" lowLabel="none" highLabel="severe" value={scores.dizziness} onChange={set('dizziness')} />
          <ScoreSelector label="Mental clarity" lowLabel="very foggy" highLabel="completely clear" value={scores.mentalClarity} onChange={set('mentalClarity')} />
          <ScoreSelector label="Impact on normal activities" lowLabel="none" highLabel="unable" value={scores.functionalImpairment} onChange={set('functionalImpairment')} />
          <AppText variant="headline">Did you eat before drinking?</AppText>
          <SegmentedControl accessibilityLabel="Ate before drinking" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={ate} onChange={setAte} />
          <AppText variant="headline">Water during the evening?</AppText>
          <SegmentedControl
            accessibilityLabel="Water during the evening"
            options={[
              { value: 'none', label: 'None' },
              { value: 'some', label: 'Some' },
              { value: 'regular', label: 'Regularly' },
            ]}
            value={hydration}
            onChange={setHydration}
          />
        </Card>
      ) : (
        <Button label="Add more detail" variant="ghost" onPress={() => setMore(true)} />
      )}
      <Card tone="safety">
        <AppText variant="footnote">
          Feeling confused, unable to keep fluids down, or concerned about symptoms? Seek medical help. A check-in score never overrides how you feel.
        </AppText>
      </Card>
    </Screen>
  );
}
