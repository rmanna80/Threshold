import { router } from 'expo-router';
import { useState } from 'react';
import { AppText, Card, ChoiceList, ToggleRow } from '../../components/ui';
import { featureFlags } from '../../config/featureFlags';
import { crashTransport } from '../../config/crashReporting';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

export default function Privacy() {
  const prefs = useAppStore((s) => s.preferences);
  const savePreferences = useAppStore((s) => s.savePreferences);
  const recordConsent = useAppStore((s) => s.recordConsent);
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const [cloud, setCloud] = useState(prefs.cloudSyncEnabled);
  const [research, setResearch] = useState(prefs.researchParticipation);
  const [crash, setCrash] = useState(prefs.crashReportingEnabled);
  const [core, setCore] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      await recordConsent('health_alcohol_data_processing', true);
      await recordConsent('cloud_sync', cloud);
      await recordConsent('research_upload', research);
      await recordConsent('crash_reporting', crash);
      await savePreferences({ cloudSyncEnabled: cloud, researchParticipation: research, crashReportingEnabled: crash });
      await completeOnboarding();
      router.replace('/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingStep
      step="privacy"
      title="Your privacy"
      subtitle="Alcohol and health information is sensitive. Threshold processes it on your device by default."
      primaryLabel="Finish setup"
      onPrimary={finish}
      primaryDisabled={!core}
      primaryLoading={busy}
    >
      <Card>
        {featureFlags.cloudSync ? (
          <ToggleRow
            label="Cloud sync (optional)"
            description="Encrypted backup and sync across your devices. Off by default. Raw sensor data is never uploaded."
            value={cloud}
            onValueChange={setCloud}
          />
        ) : (
          <AppText variant="footnote" color={colors.textSecondary}>
            Cloud sync isn’t configured in this build, so everything stays on this device.
          </AppText>
        )}
        <ToggleRow
          label="Research participation (optional)"
          description="Allows you to later opt in to specific, separately consented studies. Nothing is shared until you join a study."
          value={research}
          onValueChange={setResearch}
        />
        {crashTransport.configured ? (
          <ToggleRow
            label="Crash reports (optional)"
            description="Crash diagnostics with drink, health and check-in details removed."
            value={crash}
            onValueChange={setCrash}
          />
        ) : null}
      </Card>
      <Card title="Consent" tone="accent">
        <AppText color={colors.textSecondary}>
          To work, Threshold needs to store and process the drinks you log, your goals, check-ins and any health data you allow, on
          this device. Threshold does not sell your data or use it for advertising. You can export or delete everything at any
          time.
        </AppText>
        <ChoiceList
          multiple
          options={[{ value: 'core', label: 'I agree', description: 'I consent to Threshold processing my alcohol and health-related data as described.' }]}
          selected={core ? ['core'] : []}
          onToggle={() => setCore((v) => !v)}
        />
      </Card>
    </OnboardingStep>
  );
}
