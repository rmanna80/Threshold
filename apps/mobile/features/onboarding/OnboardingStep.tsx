import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, Button, Screen } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

export const ONBOARDING_STEPS = ['welcome', 'eligibility', 'goals', 'habits', 'permissions', 'privacy'] as const;
export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

export function OnboardingStep({
  step,
  title,
  subtitle,
  children,
  primaryLabel = 'Continue',
  onPrimary,
  primaryDisabled,
  primaryLoading,
  secondaryLabel,
  onSecondary,
}: {
  step: OnboardingStepName;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  primaryLabel?: string;
  onPrimary: () => void | Promise<void>;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const index = ONBOARDING_STEPS.indexOf(step);
  return (
    <Screen
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label={primaryLabel} onPress={onPrimary} disabled={primaryDisabled} loading={primaryLoading} size="large" />
          {secondaryLabel && onSecondary ? <Button label={secondaryLabel} variant="ghost" onPress={onSecondary} /> : null}
        </View>
      }
    >
      <View
        style={{ flexDirection: 'row', gap: spacing.xs }}
        accessible
        accessibilityLabel={`Step ${index + 1} of ${ONBOARDING_STEPS.length}`}
      >
        {ONBOARDING_STEPS.map((s, i) => (
          <View
            key={s}
            style={{ flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: i <= index ? colors.accent : colors.border }}
          />
        ))}
      </View>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <AppText variant="title1" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText color={colors.textSecondary}>{subtitle}</AppText> : null}
      </View>
      {children}
    </Screen>
  );
}
