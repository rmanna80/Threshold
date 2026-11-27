import * as Sharing from 'expo-sharing';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { AppText, Button, Card, ListRow, Screen, SectionHeader, SegmentedControl, TextField, ToggleRow } from '../../components/ui';
import { featureFlags } from '../../config/featureFlags';
import { getServices } from '../../services/container';
import { PARTICIPANT_ID_PATTERN, type DominantHand } from '../../services/research/researchService';
import type { ResearchRecordingInfo } from '../../services/research/researchStore';
import { colors } from '../../theme';

const LABEL_NAMES: Record<string, string> = {
  drinking_like: 'Drinking-like (water or non-alcoholic)',
  eating: 'Eating',
  phone_use: 'Phone use',
  face_touch: 'Touching face',
  walking: 'Walking',
  talking_gestures: 'Talking with gestures',
  sitting: 'Sitting',
  exercise: 'Exercise',
  other: 'Other',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResearchSettingsScreen() {
  const research = getServices().research;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['research'],
    queryFn: async () => ({ settings: await research.load(), recordings: await research.list() }),
  });
  const settings = data?.settings ?? null;
  const recordings: ResearchRecordingInfo[] = data?.recordings ?? [];
  const [code, setCode] = useState('');
  const [hand, setHand] = useState<DominantHand | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['research'] });
    const unsubs = [research.subscribe(invalidate), research.onFile(invalidate)];
    return () => unsubs.forEach((u) => u());
  }, [qc, research]);

  if (!featureFlags.gestureResearchMode) {
    return (
      <Screen edges={[]}>
        <Card>
          <AppText>Research recording is only available in internal research builds.</AppText>
        </Card>
      </Screen>
    );
  }

  const enroll = async () => {
    setError(null);
    if (!hand) return setError('Choose the hand you write with.');
    if (!PARTICIPANT_ID_PATTERN.test(code.trim())) return setError('Enter the study code from your information sheet (3–32 letters, numbers, - or _).');
    try {
      await research.enroll(code, hand);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enrol.');
    }
  };

  const share = async (r: ResearchRecordingInfo) => {
    if (!(await Sharing.isAvailableAsync())) return Alert.alert('Sharing is not available on this device.');
    await Sharing.shareAsync(r.uri, { mimeType: 'application/x-ndjson', dialogTitle: 'Share recording with the study team' });
  };

  const confirmWithdraw = () =>
    Alert.alert(
      'Withdraw from the study?',
      'Every recording on this phone will be deleted and the watch recorder will be switched off. Recordings you already shared with the study team must be withdrawn through the study team.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Withdraw', style: 'destructive', onPress: () => void research.withdraw() },
      ],
    );

  if (!settings) {
    return (
      <Screen edges={[]}>
        <SectionHeader title="Gesture research study" />
        <Card>
          <AppText>Only take part if a study team gave you a study code and an information sheet.</AppText>
          <AppText color={colors.textSecondary}>
            You will wear your Apple Watch and perform short, labelled activities — for example lifting a glass of water, eating, using your phone, walking — while the Threshold watch app is open.
          </AppText>
          <AppText color={colors.textSecondary}>
            Collected: wrist motion (accelerometer and gyroscope, 50 times per second), the activity label you choose, your study code, which wrist and hand you use, and the watch model. Not collected: audio, location, health records, or your name.
          </AppText>
          <AppText color={colors.textSecondary}>
            Use water or a non-alcoholic drink for drinking gestures. You are never asked to drink alcohol.
          </AppText>
          <AppText color={colors.textSecondary}>
            Recordings stay on this phone until you share a file yourself. Threshold never uploads them. You can delete any recording, or withdraw and delete all of them, at any time.
          </AppText>
        </Card>
        <Card>
          <TextField label="Study code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="e.g. TH-0042" error={error} />
          <AppText variant="footnote" color={colors.textSecondary}>
            Dominant hand
          </AppText>
          <SegmentedControl
            accessibilityLabel="Dominant hand"
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            value={hand}
            onChange={setHand}
          />
          <ToggleRow label="I have read the information sheet and agree to take part" value={agreed} onValueChange={setAgreed} />
          <Button label="Join study" onPress={() => void enroll()} disabled={!agreed} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <SectionHeader title="Study" />
      <Card>
        <AppText>Study code: {settings.participantId}</AppText>
        <AppText color={colors.textSecondary}>Dominant hand: {settings.dominantHand}</AppText>
        <ToggleRow
          label="Watch recorder"
          description={
            research.storeAvailable
              ? 'Shows the Research screen in the Threshold watch app. Recording happens only while that screen is open.'
              : 'The watch connection module is not available in this build, so recordings cannot be received.'
          }
          value={settings.recordingEnabled}
          disabled={!research.storeAvailable}
          onValueChange={(v) => void research.setRecordingEnabled(v)}
        />
      </Card>

      <SectionHeader title={`Recordings on this phone (${recordings.length})`} />
      <Card>
        {recordings.length === 0 ? (
          <AppText color={colors.textSecondary}>No recordings yet. Start one from the Research screen on your watch; it transfers here when the watch and phone are connected.</AppText>
        ) : (
          [...recordings]
            .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
            .map((r) => (
              <ListRow
                key={r.id}
                title={LABEL_NAMES[r.label ?? ''] ?? r.label ?? 'Unlabelled'}
                subtitle={`${r.startedAt ? new Date(r.startedAt).toLocaleString() : 'Unknown time'} · ${formatBytes(r.bytes)}`}
                onPress={() =>
                  Alert.alert('Recording', undefined, [
                    { text: 'Share with study team', onPress: () => void share(r) },
                    { text: 'Delete', style: 'destructive', onPress: () => void research.remove(r.id).then(() => qc.invalidateQueries({ queryKey: ['research'] })) },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
              />
            ))
        )}
      </Card>

      <SectionHeader title="Withdraw" />
      <Card tone="safety">
        <Button label="Withdraw and delete all recordings" variant="danger" onPress={confirmWithdraw} />
      </Card>
    </Screen>
  );
}
