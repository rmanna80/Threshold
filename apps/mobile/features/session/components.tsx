import { formatDuration, type PaceSnapshot } from '@threshold/core';
import type { Beverage, DrinkEvent, InterventionEvent, SessionGoalSnapshot, StandardDrinkDefinition } from '@threshold/shared-types';
import { Pressable, ScrollView, View } from 'react-native';
import { AppText, Button, Card, Chip, Stat } from '../../components/ui';
import { describeServing, formatClock, formatNumber, formatStandardDrinks } from '../../lib/format';
import { colors, minTouchTarget, radii, spacing } from '../../theme';

export function DrinkRow({ drink, def, onPress }: { drink: DrinkEvent; def: StandardDrinkDefinition; onPress?: () => void }) {
  const amount =
    drink.standardDrinks === null
      ? 'Strength unknown'
      : formatStandardDrinks(drink.standardDrinks, def);
  const portion = drink.fractionConsumed < 1 ? ` · ${Math.round(drink.fractionConsumed * 100)}% of ${describeServing(drink.servingInput)}` : ` · ${describeServing(drink.servingInput)}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${drink.beverageName}, ${amount}, at ${formatClock(drink.consumedAt)}`}
      accessibilityHint={onPress ? 'Edit or delete this drink' : undefined}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm }, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <AppText variant="body">{drink.beverageName}</AppText>
        <AppText variant="footnote" color={colors.textSecondary}>
          {formatClock(drink.consumedAt)}
          {portion}
        </AppText>
      </View>
      <View style={{ alignItems: 'flex-end', gap: spacing.xxs }}>
        <AppText variant="callout" color={drink.isAlcoholic ? colors.textPrimary : colors.info}>
          {drink.isAlcoholic ? amount : 'Non-alcoholic'}
        </AppText>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {drink.confirmation === 'estimated' ? <Chip label="Estimate" tone="estimated" /> : null}
          {drink.source === 'watch' ? <Chip label="Watch" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function PaceCard({ pace, def, goals }: { pace: PaceSnapshot; def: StandardDrinkDefinition; goals: SessionGoalSnapshot }) {
  const last = pace.timeSinceLastDrinkMs;
  return (
    <Card title="Pace" subtitle="Based on drinks you’ve confirmed" accessibilityLabel={undefined}>
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <Stat label="Last 30 min" value={formatNumber(pace.windows[30].standardDrinks)} unit={def.labelPlural} />
        <Stat label="Last 60 min" value={formatNumber(pace.windows[60].standardDrinks)} unit={def.labelPlural} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <Stat label="Last drink" value={last === null ? '—' : formatDuration(last)} caption={last === null ? undefined : 'ago'} />
        <Stat label="Avg gap" value={pace.meanIntervalMs === null ? '—' : formatDuration(pace.meanIntervalMs)} />
      </View>
      {pace.windows[60].unknownStrengthCount > 0 ? (
        <AppText variant="footnote" color={colors.estimated}>
          {pace.windows[60].unknownStrengthCount} recent drink(s) of unknown strength aren’t included in these totals.
        </AppText>
      ) : null}
      {pace.rapidConsumption ? (
        <AppText variant="callout" color={colors.accent}>
          Drinks are close together right now.
        </AppText>
      ) : pace.intervalTrend === 'shortening' ? (
        <AppText variant="callout" color={colors.accent}>
          The gaps between drinks are getting shorter.
        </AppText>
      ) : null}
      {goals.paceGoalMinutesBetweenDrinks ? (
        <AppText variant="footnote" color={colors.textTertiary}>
          Your pacing goal: about {goals.paceGoalMinutesBetweenDrinks} min between drinks (a personal preference, not a safety limit).
        </AppText>
      ) : null}
    </Card>
  );
}

export function InterventionCard({ event, onAcknowledge, onDismiss }: { event: InterventionEvent; onAcknowledge: () => void; onDismiss: () => void }) {
  return (
    <Card title={event.title} tone="accent" accessibilityLabel={`${event.title}. ${event.body}`}>
      <AppText color={colors.textPrimary}>{event.body}</AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Thanks" variant="secondary" onPress={onAcknowledge} style={{ flex: 1 }} />
        <Button label="Dismiss" variant="ghost" onPress={onDismiss} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

export function QuickLogBar({
  recent,
  onLog,
  onWater,
  onMore,
}: {
  recent: Beverage[];
  onLog: (b: Beverage) => void;
  onWater: () => void;
  onMore: () => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {recent
          .filter((b) => b.category !== 'water')
          .slice(0, 6)
          .map((b) => (
            <Pressable
              key={b.id}
              onPress={() => onLog(b)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${b.name}, ${describeServing(b.defaultServing)}`}
              style={({ pressed }) => [
                {
                  minHeight: minTouchTarget,
                  paddingHorizontal: spacing.md,
                  justifyContent: 'center',
                  borderRadius: radii.md,
                  backgroundColor: colors.surfaceHighlight,
                  borderWidth: 1,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <AppText variant="callout">{b.name}</AppText>
              <AppText variant="caption" color={colors.textTertiary}>
                {describeServing(b.defaultServing)}
              </AppText>
            </Pressable>
          ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Log a drink" onPress={onMore} style={{ flex: 2 }} size="large" />
        <Button label="Water" variant="secondary" onPress={onWater} style={{ flex: 1 }} size="large" accessibilityHint="Logs a glass of water" />
      </View>
    </View>
  );
}
