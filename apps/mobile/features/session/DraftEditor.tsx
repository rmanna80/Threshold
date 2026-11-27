import { CATEGORY_LABELS, MINUTE_MS, findTemplate, measureDrink } from '@threshold/core';
import type { BeverageCategory, StandardDrinkDefinition, VolumeUnit } from '@threshold/shared-types';
import { useMemo, useState } from 'react';
import { useNow } from '../../hooks/useNow';
import { View } from 'react-native';
import { AppText, Card, ChoiceList, SegmentedControl, Stepper, TextField, ToggleRow } from '../../components/ui';
import { formatGrams, formatStandardDrinks } from '../../lib/format';
import { colors, spacing } from '../../theme';
import { measurementFromDraft, type DrinkDraft } from './drinkInput';

const UNIT_OPTIONS: { value: VolumeUnit; label: string }[] = [
  { value: 'fl_oz_us', label: 'fl oz' },
  { value: 'ml', label: 'mL' },
  { value: 'cl', label: 'cL' },
  { value: 'fl_oz_imp', label: 'imp oz' },
];

const PORTIONS = [
  { value: '0.25', label: '¼' },
  { value: '0.5', label: '½' },
  { value: '0.75', label: '¾' },
  { value: '1', label: 'All' },
];

function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function DraftEditor({
  draft,
  onChange,
  def,
  allowTime,
  editableName,
}: {
  draft: DrinkDraft;
  onChange: (d: DrinkDraft) => void;
  def: StandardDrinkDefinition;
  allowTime: boolean;
  editableName: boolean;
}) {
  const [volumeText, setVolumeText] = useState(String(draft.serving.value));
  const [abvText, setAbvText] = useState(draft.abvPercent === null ? '' : String(draft.abvPercent));
  const template = draft.templateKey ? findTemplate(draft.templateKey) : undefined;
  const now = useNow(30_000);

  const preview = useMemo(() => measureDrink(measurementFromDraft(draft, def)), [draft, def]);

  const setVolume = (text: string) => {
    setVolumeText(text);
    const v = parseNum(text);
    onChange({ ...draft, serving: { ...draft.serving, value: v === null ? NaN : v } });
  };
  const setAbv = (text: string) => {
    setAbvText(text);
    const v = parseNum(text);
    onChange({ ...draft, abvPercent: v === null ? null : v, useTypicalRecipe: v === null ? draft.useTypicalRecipe : false });
  };

  return (
    <View style={{ gap: spacing.md }}>
      {editableName ? (
        <Card>
          <TextField label="Name" value={draft.name} onChangeText={(name) => onChange({ ...draft, name })} maxLength={80} />
          <AppText variant="footnote" color={colors.textSecondary}>
            Type
          </AppText>
          <ChoiceList
            options={(['beer', 'wine', 'spirits', 'cocktail', 'hard_seltzer', 'cider', 'mixed_drink', 'nonalcoholic'] as BeverageCategory[]).map((c) => ({
              value: c,
              label: CATEGORY_LABELS[c],
            }))}
            selected={[draft.category]}
            onToggle={(category) => onChange({ ...draft, category })}
          />
        </Card>
      ) : null}

      <Card title="Serving">
        <TextField label="Volume" keyboardType="decimal-pad" value={volumeText} onChangeText={setVolume} />
        <SegmentedControl
          accessibilityLabel="Volume unit"
          options={UNIT_OPTIONS}
          value={draft.serving.unit}
          onChange={(unit) => onChange({ ...draft, serving: { ...draft.serving, unit } })}
        />
        <AppText variant="footnote" color={colors.textSecondary}>
          How much did you drink?
        </AppText>
        <SegmentedControl
          accessibilityLabel="Portion consumed"
          options={PORTIONS}
          value={String(draft.fractionConsumed)}
          onChange={(v) => onChange({ ...draft, fractionConsumed: Number(v) })}
        />
      </Card>

      {draft.category !== 'water' ? (
        <Card title="Strength">
          <TextField
            label="Alcohol by volume (%)"
            keyboardType="decimal-pad"
            value={abvText}
            onChangeText={setAbv}
            placeholder="Leave blank if unknown"
          />
          {template?.abvVaries && draft.abvPercent !== null ? (
            <AppText variant="footnote" color={colors.textTertiary}>
              Typical value shown — check the label if you can; strength varies by product.
            </AppText>
          ) : null}
          {draft.abvPercent === null && template?.typicalRecipe ? (
            <ToggleRow
              label="Use a typical recipe"
              description="Estimate from a standard recipe. Bar pours vary, so this is logged as an estimate."
              value={draft.useTypicalRecipe}
              onValueChange={(useTypicalRecipe) => onChange({ ...draft, useTypicalRecipe })}
            />
          ) : null}
          {draft.abvPercent === null && !draft.useTypicalRecipe ? (
            <View style={{ gap: spacing.sm }}>
              <ToggleRow
                label="Give a rough estimate"
                description={`If you know roughly how strong it was, enter a range in ${def.labelPlural}. Otherwise it’s logged as “strength unknown”.`}
                value={draft.estimate !== null}
                onValueChange={(on) => onChange({ ...draft, estimate: on ? { low: 1, high: 2 } : null })}
              />
              {draft.estimate ? (
                <>
                  <Stepper label="At least" value={draft.estimate.low} min={0} max={draft.estimate.high} step={0.5} onChange={(v) => onChange({ ...draft, estimate: { low: v ?? 0, high: draft.estimate!.high } })} />
                  <Stepper label="At most" value={draft.estimate.high} min={draft.estimate.low} max={20} step={0.5} onChange={(v) => onChange({ ...draft, estimate: { low: draft.estimate!.low, high: v ?? draft.estimate!.low } })} />
                </>
              ) : null}
            </View>
          ) : null}
        </Card>
      ) : null}

      {allowTime ? (
        <Card title="When">
          <Stepper
            label="Time"
            value={draft.minutesAgo}
            min={0}
            max={360}
            step={5}
            onChange={(v) => onChange({ ...draft, minutesAgo: v ?? 0 })}
            format={(v) => (v === 0 ? 'Now' : `${v} min ago`)}
          />
          {draft.minutesAgo > 0 ? (
            <AppText variant="footnote" color={colors.textTertiary}>
              Logged at {new Date(now - draft.minutesAgo * MINUTE_MS).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <Card tone={preview.ok ? 'default' : 'safety'} accessibilityLabel={undefined}>
        {preview.ok ? (
          <View style={{ gap: spacing.xs }} accessibilityLiveRegion="polite">
            <AppText variant="headline">
              {preview.value.standardDrinks === null
                ? 'Strength unknown — counted as a drink, not added to totals'
                : formatStandardDrinks(preview.value.standardDrinks, def)}
            </AppText>
            {preview.value.ethanolGrams !== null ? (
              <AppText variant="footnote" color={colors.textSecondary}>
                ≈ {formatGrams(preview.value.ethanolGrams)} of pure alcohol
                {preview.value.confirmation === 'estimated' ? ' (estimate)' : ''}
              </AppText>
            ) : null}
            {preview.warnings
              .filter((w) => w.code !== 'abv_unknown' && w.code !== 'estimated')
              .map((w) => (
                <AppText key={w.code} variant="footnote" color={colors.estimated}>
                  {w.message}
                </AppText>
              ))}
          </View>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {preview.errors.map((e) => (
              <AppText key={e.code + e.field} color={colors.safety}>
                {e.message}
              </AppText>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

export function draftIsValid(draft: DrinkDraft, def: StandardDrinkDefinition): boolean {
  return measureDrink(measurementFromDraft(draft, def)).ok && draft.name.trim().length > 0;
}
