import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { colors, typography } from '../../theme';

export type TextVariant = keyof typeof typography;

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  children?: ReactNode;
}

/** Text that scales with Dynamic Type (allowFontScaling defaults to true; capped for layout safety). */
export function AppText({ variant = 'body', color = colors.textPrimary, align, style, children, ...rest }: AppTextProps) {
  const t = typography[variant] as TextStyle;
  return (
    <Text maxFontSizeMultiplier={2} style={[t, { color, textAlign: align }, style]} {...rest}>
      {children}
    </Text>
  );
}
