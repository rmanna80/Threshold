import type { ConsentType } from '@threshold/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { AppText, Button, Card, Screen, SectionHeader, ToggleRow } from '../../components/ui';
import { crashTransport } from '../../config/crashReporting';
import { featureFlags } from '../../config/featureFlags';
import { getServices } from '../../services/container';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

export default function PrivacySettings() {
  const consents = useAppStore((s) => s.consents);
  const prefs = useAppStore((s) => s.preferences);
  const recordConsent = useAppStore((s) => s.recordConsent);
  const savePreferences = useAppStore((s) => s.savePreferences);
  const qc = useQueryClient();
  const granted = (t: ConsentType) => Boolean(consents[t]?.granted);

  const toggleHealth = async (on: boolean) => {
    await recordConsent('healthkit', on);
    if (on) {
      await getServices().health.requestAuthorization();
      await getServices().healthService.sync(30);
    } else {
      // Revoking consent removes Threshold's local copies; Apple Health itself is untouched.
      await getServices().repos.measurements.deleteAll();
    }
    void qc.invalidateQueries({ queryKey: ['health'] });
  };

  const toggleNotifications = async (on: boolean) => {
    if (on) {
      const r = await getServices().notifications.requestPermission();
      await recordConsent('notifications', r === 'granted');
      if (r !== 'granted') void Linking.openSettings();
    } else {
      await recordConsent('notifications', false);
      await getServices().notifications.cancelAll();
    }
  };

  return (
    <Screen edges={[]}>
      <SectionHeader title="Data sources" />
      <Card>
        <ToggleRow
          label="Apple Health"
          description="Read heart rate, HRV, resting heart rate, respiratory rate and sleep. Turning this off deletes Threshold’s local copies. To fully revoke access, also use the Health app → Sharing → Apps."
          value={granted('healthkit')}
          onValueChange={(v) => void toggleHealth(v)}
        />
        <ToggleRow label="Notifications" description="Pacing and goal reminders." value={granted('notifications')} onValueChange={(v) => void toggleNotifications(v)} />
        {featureFlags.automaticDetectionPrompt ? (
          <ToggleRow
            label="Watch motion (experimental)"
            description="Drinking-like gesture prompts while the watch app is open. Never counts drinks on its own."
            value={prefs.automaticDetectionEnabled}
            onValueChange={async (v) => {
              await recordConsent('automatic_detection', v);
              await savePreferences({ automaticDetectionEnabled: v });
            }}
          />
        ) : (
          <AppText variant="footnote" color={colors.textTertiary}>
            Watch gesture prompts are not available in this version: they stay off until a gesture model passes validation on real, consented recordings.
          </AppText>
        )}
      </Card>

      <SectionHeader title="Sharing" />
      <Card>
        {featureFlags.cloudSync ? (
          <ToggleRow
            label="Cloud sync"
            description="Optional encrypted sync. Raw sensor data is never uploaded."
            value={prefs.cloudSyncEnabled}
            onValueChange={async (v) => {
              await recordConsent('cloud_sync', v);
              await savePreferences({ cloudSyncEnabled: v });
            }}
          />
        ) : null}
        <ToggleRow
          label="Research participation"
          description="Allows invitations to separately consented studies. Turning this off withdraws you from future research uploads."
          value={prefs.researchParticipation}
          onValueChange={async (v) => {
            await recordConsent('research_upload', v);
            await savePreferences({ researchParticipation: v });
          }}
        />
        {crashTransport.configured ? (
          <ToggleRow
            label="Crash reports"
            description="Diagnostics with drink, health and check-in details removed."
            value={prefs.crashReportingEnabled}
            onValueChange={async (v) => {
              await recordConsent('crash_reporting', v);
              await savePreferences({ crashReportingEnabled: v });
            }}
          />
        ) : (
          <AppText variant="footnote" color={colors.textTertiary}>
            Crash reports: this build has no crash-reporting service, so no diagnostics are sent.
          </AppText>
        )}
      </Card>

      <SectionHeader title="Commitments" />
      <Card>
        <AppText color={colors.textSecondary}>• Threshold does not sell health or alcohol data.</AppText>
        <AppText color={colors.textSecondary}>• Apple Health data is never used for advertising.</AppText>
        <AppText color={colors.textSecondary}>• Raw biometric data is not sent to external AI services.</AppText>
        <AppText variant="footnote" color={colors.textTertiary}>
          Consent history is kept on this device and included in your data export.
        </AppText>
      </Card>
      <Button label="Open iOS Settings" variant="secondary" onPress={() => void Linking.openSettings()} />
    </Screen>
  );
}
