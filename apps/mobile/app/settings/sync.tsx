import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AppText, Button, Card, Screen, SectionHeader, SegmentedControl, TextField, ToggleRow } from '../../components/ui';
import { getServices } from '../../services/container';
import { shareTextFile } from '../../services/fileExport';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

export default function SyncSettings() {
  const { api, sync, repos } = getServices();
  const prefs = useAppStore((s) => s.preferences);
  const savePreferences = useAppStore((s) => s.savePreferences);
  const recordConsent = useAppStore((s) => s.recordConsent);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: async () => ({
      signedIn: (await api?.isSignedIn()) ?? false,
      pending: await repos.syncQueue.pendingCount(),
      last: await repos.kv.get('sync_last_success'),
    }),
  });

  if (!api || !sync) {
    return (
      <Screen edges={[]}>
        <AppText color={colors.textSecondary}>Cloud sync isn’t configured in this build. All data stays on this device.</AppText>
      </Screen>
    );
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await status.refetch();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    act(async () => {
      await api.signIn(mode, email.trim(), password);
      setPassword('');
      await recordConsent('cloud_sync', true);
      await savePreferences({ cloudSyncEnabled: true });
      await sync.backfill();
      await sync.syncNow();
    });

  const deleteCloud = () =>
    Alert.prompt?.(
      'Delete cloud account',
      'Enter your password to permanently delete your account and all synced data from the server. Data on this phone is kept.',
      (pw) =>
        void act(async () => {
          await api.deleteAccount(pw);
          await savePreferences({ cloudSyncEnabled: false });
          await recordConsent('cloud_sync', false);
          await repos.syncQueue.clear();
          await repos.kv.delete('sync_cursor');
        }),
      'secure-text',
    );

  if (!status.data?.signedIn) {
    return (
      <Screen edges={[]}>
        <Card>
          <AppText color={colors.textSecondary}>
            Optional. Sync backs up sessions, drinks and check-ins so they can be restored on a new phone. Payloads are encrypted on the server. Raw sensor data is never uploaded.
          </AppText>
        </Card>
        <SegmentedControl
          accessibilityLabel="Sign in or create account"
          options={[
            { value: 'login', label: 'Sign in' },
            { value: 'register', label: 'Create account' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <TextField label="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" value={email} onChangeText={setEmail} />
        <TextField label="Password (10+ characters)" secureTextEntry textContentType={mode === 'register' ? 'newPassword' : 'password'} value={password} onChangeText={setPassword} />
        <Button label={mode === 'login' ? 'Sign in' : 'Create account'} onPress={signIn} loading={busy} disabled={!email.includes('@') || password.length < 10} />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Card>
        <ToggleRow
          label="Sync enabled"
          description="When off, nothing new is uploaded."
          value={prefs.cloudSyncEnabled}
          onValueChange={async (v) => {
            await recordConsent('cloud_sync', v);
            await savePreferences({ cloudSyncEnabled: v });
            if (v) await sync.backfill();
          }}
        />
        <AppText variant="footnote" color={colors.textSecondary}>
          {status.data.pending} change(s) waiting · last synced {status.data.last ? new Date(Number(status.data.last)).toLocaleString() : 'never'}
        </AppText>
        <Button label="Sync now" onPress={() => act(async () => void (await sync.syncNow()))} loading={busy} disabled={!prefs.cloudSyncEnabled} />
      </Card>
      <SectionHeader title="Account" />
      <Card>
        <Button
          label="Download cloud copy (JSON)"
          variant="secondary"
          onPress={() => act(async () => shareTextFile('threshold-cloud-export.json', JSON.stringify(await api.exportAccount(), null, 2), 'application/json'))}
        />
        <Button label="Sign out" variant="secondary" onPress={() => act(() => api.signOut())} />
        <Button label="Delete cloud account" variant="danger" onPress={deleteCloud} />
      </Card>
    </Screen>
  );
}
