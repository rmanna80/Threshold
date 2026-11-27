import Constants from 'expo-constants';
import { router } from 'expo-router';
import { AppText, Card, ListRow, Screen, SectionHeader } from '../../components/ui';
import { featureFlags } from '../../config/featureFlags';
import { definitionFor } from '../../lib/format';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';
import { WatchStatusRow } from '../../features/profile/WatchStatusRow';

export default function Profile() {
  const prefs = useAppStore((s) => s.preferences);
  const encrypted = useAppStore((s) => s.encryptedStorage);
  const def = definitionFor(prefs);
  return (
    <Screen>
      <AppText variant="title1" accessibilityRole="header">
        Profile
      </AppText>

      <SectionHeader title="Moderation" />
      <Card>
        <ListRow title="Goals" subtitle="Personal goals and objectives" onPress={() => router.push('/settings/goals')} />
        <ListRow title="Preferences" subtitle={`${def.labelPlural} (${def.gramsEthanol} g) · reminders ${prefs.notificationFrequency}${prefs.quietMode ? ' · quiet' : ''}`} onPress={() => router.push('/settings/preferences')} />
      </Card>

      <SectionHeader title="Devices" />
      <Card>
        <WatchStatusRow />
      </Card>

      <SectionHeader title="Privacy & data" />
      <Card>
        <ListRow title="Permissions & consent" subtitle="Apple Health, notifications, motion, research" onPress={() => router.push('/settings/privacy')} />
        <ListRow title="Export or delete data" subtitle="CSV, JSON, account and local deletion" onPress={() => router.push('/settings/data')} />
        {featureFlags.cloudSync ? <ListRow title="Cloud sync" subtitle={prefs.cloudSyncEnabled ? 'On' : 'Off'} onPress={() => router.push('/settings/sync')} /> : null}
        <AppText variant="footnote" color={colors.textTertiary}>
          {encrypted ? 'Local data is encrypted on this device.' : 'Local database encryption is unavailable in this build.'}
        </AppText>
      </Card>

      <SectionHeader title="Safety" />
      <Card tone="safety">
        <ListRow title="Emergency information" subtitle="Signs of alcohol poisoning and who to call" onPress={() => router.push('/emergency')} />
      </Card>

      {featureFlags.gestureResearchMode ? (
        <>
          <SectionHeader title="Research" />
          <Card>
            <ListRow title="Gesture research recording" subtitle="Internal builds only — consenting participants" onPress={() => router.push('/settings/research')} />
          </Card>
        </>
      ) : null}

      <SectionHeader title="About" />
      <Card>
        <ListRow title="About Threshold" subtitle={`Version ${Constants.expoConfig?.version ?? '—'} · Comeback Technologies LLC`} onPress={() => router.push('/settings/about')} />
      </Card>
    </Screen>
  );
}
