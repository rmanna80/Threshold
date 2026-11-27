import { View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { AppText } from '../ui/AppText';
import { colors, spacing } from '../../theme';

export interface BarDatum {
  label: string;
  value: number;
  /** Visual emphasis for a bar (e.g. current week). */
  highlight?: boolean;
  /** Marks bars containing estimated values. */
  estimated?: boolean;
}

/**
 * Minimal, accessible bar chart. The whole chart is a single accessibility element whose label
 * reads out every value, so VoiceOver users get the data rather than shapes.
 */
export function BarChart({
  data,
  height = 140,
  width = 320,
  color = colors.accent,
  unit,
  referenceLine,
  accessibilityLabel,
  formatValue = (v: number) => String(Math.round(v * 10) / 10),
}: {
  data: BarDatum[];
  height?: number;
  width?: number;
  color?: string;
  unit: string;
  referenceLine?: { value: number; label: string } | null;
  accessibilityLabel: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value), referenceLine?.value ?? 0);
  const chartH = height - 28;
  const gap = 6;
  const barW = data.length ? (width - gap * (data.length - 1)) / data.length : 0;
  const spoken = data.map((d) => `${d.label}: ${formatValue(d.value)} ${unit}${d.estimated ? ', includes estimates' : ''}`).join('; ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${accessibilityLabel}. ${spoken || 'No data.'}`}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {data.map((d, i) => {
          const h = (d.value / max) * (chartH - 4);
          const x = i * (barW + gap);
          return (
            <Rect
              key={`${d.label}-${i}`}
              x={x}
              y={chartH - h}
              width={Math.max(1, barW)}
              height={Math.max(d.value > 0 ? 2 : 0, h)}
              rx={4}
              fill={d.highlight ? color : colors.borderStrong}
              opacity={d.estimated ? 0.7 : 1}
            />
          );
        })}
        {referenceLine ? (
          <Line
            x1={0}
            x2={width}
            y1={chartH - (referenceLine.value / max) * (chartH - 4)}
            y2={chartH - (referenceLine.value / max) * (chartH - 4)}
            stroke={colors.textTertiary}
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        ) : null}
        {data.map((d, i) =>
          data.length <= 14 || i % Math.ceil(data.length / 7) === 0 ? (
            <SvgText key={`l-${i}`} x={i * (barW + gap) + barW / 2} y={height - 8} fontSize={10} fill={colors.textTertiary} textAnchor="middle">
              {d.label}
            </SvgText>
          ) : null,
        )}
      </Svg>
      {referenceLine ? (
        <AppText variant="caption" color={colors.textTertiary}>
          Dashed line: {referenceLine.label}
        </AppText>
      ) : null}
    </View>
  );
}

const LEVEL_COLORS = [colors.surfaceHighlight, 'rgba(217,165,91,0.30)', 'rgba(217,165,91,0.50)', 'rgba(217,165,91,0.75)', colors.accent];

export function CalendarHeatmap({
  cells,
  accessibilityLabel,
}: {
  cells: { date: string; level: 0 | 1 | 2 | 3 | 4; future: boolean; standardDrinks: number }[];
  accessibilityLabel: string;
}) {
  const size = 14;
  const gap = 3;
  const weeks = Math.ceil(cells.length / 7);
  const width = weeks * (size + gap);
  const height = 7 * (size + gap);
  const afDays = cells.filter((c) => !c.future && c.level === 0).length;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${accessibilityLabel}. ${afDays} alcohol-free days out of ${cells.filter((c) => !c.future).length}.`}
      style={{ gap: spacing.sm }}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {cells.map((c, i) => (
          <Rect
            key={c.date}
            x={Math.floor(i / 7) * (size + gap)}
            y={(i % 7) * (size + gap)}
            width={size}
            height={size}
            rx={3}
            fill={c.future ? 'transparent' : LEVEL_COLORS[c.level]}
            stroke={c.future ? colors.border : 'none'}
          />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <AppText variant="caption" color={colors.textTertiary}>
          Alcohol-free
        </AppText>
        {LEVEL_COLORS.map((c, i) => (
          <View key={i} style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: c }} />
        ))}
        <AppText variant="caption" color={colors.textTertiary}>
          More recorded
        </AppText>
      </View>
    </View>
  );
}
