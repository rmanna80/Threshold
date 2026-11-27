import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card } from '../../components/ui';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { getServices } from '../../services/container';
import { useAppStore } from '../../stores/appStore';
import { colors, spacing } from '../../theme';

type Decision = 'allowed' | 'declined' | null;

function PermissionCard({
  title,
  why,
  detail,
  decision,
  onAllow,
  onDecline,
  allowLabel = 'Allow',
}: {
  title: string;
  why: string;
  detail: string;
  decision: Decision;
  onAllow: () => void;
  onDecline: () => void;
  allowLabel?: string;
}) {
  return (
    <Card title={title} subtitle={decision === 'allowed' ? 'Requested' : decision === 'declined' ? 'Not now' : undefined}>
      <AppText color={colors.textSecondary}>{why}</AppText>
      <AppText variant="footnote" color={colors.textTertiary}>
        {detail}
      </AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label={allowLabel} onPress={onAllow} style={{ flex: 1 }} variant={decision === 'allowed' ? 'secondary' : 'primary'} />
        <Button label="Not now" onPress={onDecline} variant="ghost" style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

export default function Permissions() {
  const recordConsent = useAppStore((s) => s.recordConsent);
  const savePreferences = useAppStore((s) => s.savePreferences);
  const hasWatch = useAppStore((s) => s.preferences.hasAppleWatch);
  const [notif, setNotif] = useState<Decision>(null);
  const [health, setHealth] = useState<Decision>(null);
  const [motion, setMotion] = useState<Decision>(null);

  const allowNotifications = async () => {
    const result = await getServices().notifications.requestPermission();
    await recordConsent('notifications', result === 'granted');
    setNotif(result === 'granted' ? 'allowed' : 'declined');
  };
  const allowHealth = async () => {
    await recordConsent('healthkit', true);
    await getServices().health.requestAuthorization();
    setHealth('allowed');
  };
  const allowMotion = async () => {
    await recordConsent('motion', true);
    await recordConsent('automatic_detection', true);
    await savePreferences({ automaticDetectionEnabled: true });
    setMotion('allowed');
  };

  return (
    <OnboardingStep
      step="permissions"
      title="Permissions"
      subtitle="Each one is optional. Threshold works fully without them — you can change your mind later in Profile."
      onPrimary={() => router.push('/privacy')}
    >
      <PermissionCard
        title="Notifications"
        why="Pacing reminders and goal check-ins during an evening, and an optional morning check-in prompt."
        detail="Delivered locally by your phone and watch, even offline. You choose how often in settings."
        decision={notif}
        onAllow={allowNotifications}
        onDecline={async () => {
          await recordConsent('notifications', false);
          setNotif('declined');
        }}
      />
      <PermissionCard
        title="Apple Health"
        why="Read heart rate, HRV, resting heart rate, respiratory rate and sleep to describe how your body responds around drinking."
        detail="Read-only. Apple Health doesn’t tell apps which types you allowed, so Threshold shows “no data” when nothing is shared. Readings are intermittent, not live."
        decision={health}
        onAllow={allowHealth}
        onDecline={async () => {
          await recordConsent('healthkit', false);
          setHealth('declined');
        }}
      />
      {hasWatch !== false ? (
        <PermissionCard
          title="Watch motion (experimental)"
          why="Lets your Apple Watch notice repeated drinking-like wrist movements while the Threshold watch app is open and ask whether you want to start a session."
          detail="Motion never counts as a drink by itself, and Threshold can’t tell what is in your glass. Your watch will ask for Motion & Fitness access when the feature first runs."
          allowLabel="Enable"
          decision={motion}
          onAllow={allowMotion}
          onDecline={async () => {
            await recordConsent('automatic_detection', false);
            await savePreferences({ automaticDetectionEnabled: false });
            setMotion('declined');
          }}
        />
      ) : null}
    </OnboardingStep>
  );
}
