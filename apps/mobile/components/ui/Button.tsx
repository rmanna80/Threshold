import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { colors, minTouchTarget, radii, spacing } from '../../theme';
import { AppText } from './AppText';

export interface ButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'regular' | 'large';
  disabled?: boolean;
  loading?: boolean;
  haptic?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled,
  loading,
  haptic = true,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const textColor =
    variant === 'primary' ? colors.background : variant === 'danger' ? colors.safety : variant === 'ghost' ? colors.accent : colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      disabled={isDisabled}
      onPress={() => {
        if (haptic) void Haptics.selectionAsync().catch(() => undefined);
        void onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'large' && styles.large,
        styles[variant],
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <AppText variant="headline" color={textColor}>{label}</AppText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: { minHeight: 60, borderRadius: radii.lg },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceHighlight, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.safetyTint, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.safety },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
