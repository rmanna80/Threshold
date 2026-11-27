import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AppText, Button, Card, Screen, SectionHeader } from '../../components/ui';
import { featureFlags } from '../../config/featureFlags';
import { getServices } from '../../services/container';
import { checkinsCsv, collectExport, deleteAllLocalData, drinksCsv, sessionsCsv } from '../../services/dataService';
import { shareTextFile } from '../../services/fileExport';
import { queryClient } from '../../services/queryClient';
import { useAppStore } from '../../stores/appStore';
import { useSessionStore } from '../../stores/sessionStore';
import { colors } from '../../theme';

export default function DataSettings() {
  const [busy, setBusy] = useState<string | null>(null);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const exportJson = () =>
    run('json', async () => {
      const bundle = await collectExport(getServices(), version);
      await shareTextFile(`threshold-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    });

  const exportCsv = (kind: 'drinks' | 'sessions' | 'checkins') =>
    run(kind, async () => {
      const { repos } = getServices();
      const content =
        kind === 'drinks' ? drinksCsv(await repos.drinks.listAll()) : kind === 'sessions' ? sessionsCsv(await repos.sessions.listAll()) : checkinsCsv(await repos.checkins.listAll());
      await shareTextFile(`threshold-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, content, 'text/csv');
    });

  const confirmDelete = () =>
    Alert.alert(
      'Delete all data on this device?',
      'Sessions, drinks, check-ins, goals, settings and Threshold’s copies of health data will be permanently erased. Apple Health itself is not changed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            void run('delete', async () => {
              const s = getServices();
              await s.notifications.cancelAll();
              await deleteAllLocalData(s);
              queryClient.clear();
              useSessionStore.setState({ session: null, drinks: [], interventions: [] });
              useAppStore.setState({ onboardingCompleted: false, consents: {}, eligibility: null });
              await useAppStore.getState().hydrate();
              router.replace('/welcome');
            }),
        },
      ],
    );

  return (
    <Screen edges={[]}>
      <SectionHeader title="Export" />
      <Card>
        <AppText color={colors.textSecondary}>Exports are created on your device and shared only where you choose.</AppText>
        <Button label="Everything (JSON)" onPress={exportJson} loading={busy === 'json'} />
        <Button label="Drinks (CSV)" variant="secondary" onPress={() => exportCsv('drinks')} loading={busy === 'drinks'} />
        <Button label="Sessions (CSV)" variant="secondary" onPress={() => exportCsv('sessions')} loading={busy === 'sessions'} />
        <Button label="Check-ins (CSV)" variant="secondary" onPress={() => exportCsv('checkins')} loading={busy === 'checkins'} />
      </Card>

      {featureFlags.cloudSync ? (
        <>
          <SectionHeader title="Cloud account" />
          <Card>
            <AppText color={colors.textSecondary}>To delete your cloud account and all synced data, open Cloud sync.</AppText>
            <Button label="Cloud sync & account" variant="secondary" onPress={() => router.push('/settings/sync')} />
          </Card>
        </>
      ) : null}

      <SectionHeader title="Delete" />
      <Card tone="safety">
        <AppText>Remove every record Threshold has stored on this device.</AppText>
        <Button label="Delete all local data" variant="danger" onPress={confirmDelete} loading={busy === 'delete'} />
      </Card>
    </Screen>
  );
}
