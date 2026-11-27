import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../../theme';
import { AppText } from './AppText';

export interface CardProps {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  tone?: 'default' | 'accent' | 'safety' | 'goal' | 'info';
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const toneStyles: Record<NonNullable<CardProps['tone']>, ViewStyle> = {
  default: {},
  accent: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  safety: { borderColor: colors.safety, backgroundColor: colors.safetyTint },
  goal: { borderColor: colors.goalComplete, backgroundColor: colors.goalCompleteTint },
  info: { borderColor: colors.info, backgroundColor: colors.infoTint },
};

export function Card({ title, subtitle, right, children, onPress, tone = 'default', style, accessibilityLabel, accessibilityHint }: CardProps) {
  const content = (
    <>
      {title || right ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? <AppText variant="headline">{title}</AppText> : null}
            {subtitle ? (
              <AppText variant="footnote" color={colors.textSecondary}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.card, toneStyles[tone], pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, toneStyles[tone], style]} accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headerText: { flex: 1, gap: spacing.xxs },
});
