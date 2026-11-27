import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';
import { colors, minTouchTarget, radii, spacing } from '../../theme';
import { AppText } from './AppText';

/* ------------------------------------------------------------------------ */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, selected && styles.segmentSelected]}
          >
            <AppText variant="callout" color={selected ? colors.background : colors.textPrimary} align="center">
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
export function ChoiceList<T extends string>({
  options,
  selected,
  onToggle,
  multiple,
}: {
  options: { value: T; label: string; description?: string }[];
  selected: T[];
  onToggle: (v: T) => void;
  multiple?: boolean;
}) {
  return (
    <View style={{ gap: spacing.sm }} accessibilityRole={multiple ? undefined : 'radiogroup'}>
      {options.map((o) => {
        const isOn = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onToggle(o.value)}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={multiple ? { checked: isOn } : { selected: isOn }}
            accessibilityLabel={o.description ? `${o.label}. ${o.description}` : o.label}
            style={[styles.choice, isOn && styles.choiceOn]}
          >
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <AppText variant="headline">{o.label}</AppText>
              {o.description ? (
                <AppText variant="footnote" color={colors.textSecondary}>
                  {o.description}
                </AppText>
              ) : null}
            </View>
            <View style={[styles.indicator, isOn && styles.indicatorOn, !multiple && styles.radio]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <AppText variant="headline">{label}</AppText>
        {description ? (
          <AppText variant="footnote" color={colors.textSecondary}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.borderStrong }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

/* ------------------------------------------------------------------------ */
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
  allowNull,
  nullLabel = 'Not set',
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  allowNull?: boolean;
  nullLabel?: string;
}) {
  const dec = () => {
    if (value === null) return;
    const next = Math.round((value - step) * 100) / 100;
    if (next < min) onChange(allowNull ? null : min);
    else onChange(next);
  };
  const inc = () => {
    if (value === null) onChange(min);
    else onChange(Math.min(max, Math.round((value + step) * 100) / 100));
  };
  const display = value === null ? nullLabel : format(value);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: display }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? inc() : dec())}
    >
      <AppText variant="headline" style={{ flex: 1 }}>
        {label}
      </AppText>
      <View style={styles.stepper}>
        <Pressable onPress={dec} style={styles.stepBtn} accessibilityElementsHidden importantForAccessibility="no">
          <AppText variant="title2">−</AppText>
        </Pressable>
        <AppText variant="headline" style={styles.stepValue} align="center">
          {display}
        </AppText>
        <Pressable onPress={inc} style={styles.stepBtn} accessibilityElementsHidden importantForAccessibility="no">
          <AppText variant="title2">+</AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
export function TextField({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="footnote" color={colors.textSecondary}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, error ? { borderColor: colors.safety } : null]}
        {...props}
      />
      {error ? (
        <AppText variant="footnote" color={colors.safety} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
export function ScoreSelector({
  label,
  lowLabel,
  highLabel,
  value,
  onChange,
}: {
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <AppText variant="headline">{label}</AppText>
        <Pressable onPress={() => onChange(null)} accessibilityRole="button" accessibilityLabel={`Skip ${label}`}>
          <AppText variant="footnote" color={value === null ? colors.textTertiary : colors.accent}>
            {value === null ? 'Skipped' : 'Skip'}
          </AppText>
        </Pressable>
      </View>
      <View style={styles.scoreRow} accessibilityRole="radiogroup" accessibilityLabel={`${label}, 0 ${lowLabel} to 10 ${highLabel}`}>
        {Array.from({ length: 11 }, (_, i) => (
          <Pressable
            key={i}
            onPress={() => onChange(i)}
            accessibilityRole="radio"
            accessibilityLabel={`${i}`}
            accessibilityState={{ selected: value === i }}
            style={[styles.scoreCell, value === i && styles.scoreSelected]}
          >
            <AppText variant="callout" color={value === i ? colors.background : colors.textPrimary} align="center">
              {i}
            </AppText>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="caption" color={colors.textTertiary}>
          0 · {lowLabel}
        </AppText>
        <AppText variant="caption" color={colors.textTertiary}>
          10 · {highLabel}
        </AppText>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
export function Chip({ label, tone = 'default' }: { label: string; tone?: 'default' | 'observed' | 'estimated' | 'missing' | 'experimental' | 'safety' }) {
  const color =
    tone === 'estimated' ? colors.estimated : tone === 'missing' ? colors.missing : tone === 'experimental' ? colors.experimental : tone === 'safety' ? colors.safety : colors.textSecondary;
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <AppText variant="caption" color={color}>
        {label}
      </AppText>
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
      <AppText variant="caption" color={colors.textTertiary} accessibilityRole="header">
        {title.toUpperCase()}
      </AppText>
      {action}
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <>
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <AppText variant="body">{title}</AppText>
        {subtitle ? (
          <AppText variant="footnote" color={colors.textSecondary}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.listRow}>{body}</View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceHighlight, borderRadius: radii.md, padding: spacing.xxs },
  segmentItem: { flex: 1, minHeight: minTouchTarget - 4, justifyContent: 'center', borderRadius: radii.sm, paddingHorizontal: spacing.xs },
  segmentSelected: { backgroundColor: colors.accent },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: minTouchTarget,
  },
  choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  indicator: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong },
  radio: { borderRadius: 11 },
  indicatorOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouchTarget },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 72 },
  input: {
    minHeight: minTouchTarget,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    fontSize: 17,
  },
  scoreRow: { flexDirection: 'row', gap: 4 },
  scoreCell: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
  },
  scoreSelected: { backgroundColor: colors.accent },
  chip: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm },
});
