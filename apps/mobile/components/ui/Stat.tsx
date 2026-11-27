import { View } from 'react-native';
import { colors, spacing } from '../../theme';
import { AppText } from './AppText';

export function Stat({ label, value, unit, caption, emphasis }: { label: string; value: string; unit?: string; caption?: string; emphasis?: boolean }) {
  return (
    <View style={{ gap: spacing.xxs, flex: 1 }} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}${caption ? `. ${caption}` : ''}`}>
      <AppText variant="caption" color={colors.textTertiary}>
        {label.toUpperCase()}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
        <AppText variant={emphasis ? 'numeric' : 'title2'} style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </AppText>
        {unit ? (
          <AppText variant="footnote" color={colors.textSecondary}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {caption ? (
        <AppText variant="footnote" color={colors.textSecondary}>
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}
