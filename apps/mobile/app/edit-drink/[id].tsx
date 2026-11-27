import { MINUTE_MS } from '@threshold/core';
import type { DrinkEvent } from '@threshold/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { AppText, Button, Card, Screen, Stepper } from '../../components/ui';
import { DraftEditor, draftIsValid } from '../../features/session/DraftEditor';
import { measurementFromDraft, type DrinkDraft } from '../../features/session/drinkInput';
import { definitionFor, formatClock } from '../../lib/format';
import { getServices } from '../../services/container';
import { useAppStore } from '../../stores/appStore';
import { useSessionStore } from '../../stores/sessionStore';
import { colors, spacing } from '../../theme';

function draftFromDrink(d: DrinkEvent): DrinkDraft {
  const low = d.uncertainty.standardDrinksLow;
  const high = d.uncertainty.standardDrinksHigh;
  return {
    beverageId: d.beverageId,
    templateKey: null,
    name: d.beverageName,
    category: d.category,
    serving: { ...d.servingInput },
    // Recipe-based drinks store an effective ABV, which keeps edits deterministic.
    abvPercent: d.abvPercent,
    fractionConsumed: d.fractionConsumed,
    useTypicalRecipe: false,
    // Stored ranges are already scaled by portion; convert back to the full serving.
    estimate: low !== null && high !== null && d.abvPercent === null ? { low: low / d.fractionConsumed, high: high / d.fractionConsumed } : null,
    minutesAgo: 0,
  };
}

export default function EditDrink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prefs = useAppStore((s) => s.preferences);
  const { editDrink, deleteDrink } = useSessionStore.getState();
  const qc = useQueryClient();
  const def = definitionFor(prefs);
  const [original, setOriginal] = useState<DrinkEvent | null>(null);
  const [draft, setDraft] = useState<DrinkDraft | null>(null);
  const [shiftMin, setShiftMin] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getServices()
      .repos.drinks.getById(String(id))
      .then((d) => {
        if (!alive || !d) return;
        setOriginal(d);
        setDraft(draftFromDrink(d));
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!original || !draft) {
    return (
      <Screen edges={['top', 'bottom']}>
        <AppText color={colors.textSecondary}>Loading…</AppText>
      </Screen>
    );
  }

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['history'] });
    router.back();
  };

  const save = async () => {
    setBusy(true);
    const r = await editDrink(original.id, {
      measurement: measurementFromDraft(draft, def),
      beverageName: draft.name,
      consumedAt: shiftMin !== 0 ? original.consumedAt + shiftMin * MINUTE_MS : undefined,
    });
    setBusy(false);
    if (!r.ok) Alert.alert('Couldn’t save', r.errors.map((e) => e.message).join('\n'));
    else done();
  };

  const remove = () =>
    Alert.alert('Delete this drink?', 'It will be removed from your totals.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteDrink(original.id);
          done();
        },
      },
    ]);

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button label="Save" onPress={save} loading={busy} disabled={!draftIsValid(draft, def)} style={{ flex: 2 }} />
        </View>
      }
    >
      <AppText variant="title2" accessibilityRole="header">
        Edit drink
      </AppText>
      <DraftEditor draft={draft} onChange={setDraft} def={def} allowTime={false} editableName />
      <Card title="Time">
        <Stepper
          label={`Logged ${formatClock(original.consumedAt)}`}
          value={shiftMin}
          min={-180}
          max={180}
          step={5}
          onChange={(v) => setShiftMin(v ?? 0)}
          format={(v) => (v === 0 ? 'No change' : `${v > 0 ? '+' : ''}${v} min`)}
        />
      </Card>
      <Button label="Delete drink" variant="danger" onPress={remove} />
    </Screen>
  );
}
