import { BEVERAGE_TEMPLATES, CATEGORY_LABELS, MINUTE_MS, type BeverageTemplate } from '@threshold/core';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { AppText, Button, Card, ListRow, Screen, SectionHeader } from '../components/ui';
import { featureFlags } from '../config/featureFlags';
import { DraftEditor, draftIsValid } from '../features/session/DraftEditor';
import { draftFromBeverage, draftFromTemplate, ensureBeverage, measurementFromDraft, type DrinkDraft } from '../features/session/drinkInput';
import { useRecentBeverages } from '../features/session/useSessionData';
import { definitionFor, describeServing } from '../lib/format';
import { getServices } from '../services/container';
import { useAppStore } from '../stores/appStore';
import { useDraftStore } from '../stores/draftStore';
import { useSessionStore } from '../stores/sessionStore';
import { colors, spacing } from '../theme';

const GROUPS: BeverageTemplate['category'][] = ['beer', 'wine', 'spirits', 'hard_seltzer', 'cider', 'mixed_drink', 'cocktail', 'nonalcoholic', 'water'];

const BLANK: DrinkDraft = {
  beverageId: null,
  templateKey: null,
  name: '',
  category: 'custom',
  serving: { value: 12, unit: 'fl_oz_us' },
  abvPercent: null,
  fractionConsumed: 1,
  useTypicalRecipe: false,
  estimate: null,
  minutesAgo: 0,
};

export default function LogDrink() {
  const prefs = useAppStore((s) => s.preferences);
  const session = useSessionStore((s) => s.session);
  const { start, logDrink } = useSessionStore.getState();
  const recent = useRecentBeverages();
  const qc = useQueryClient();
  const def = definitionFor(prefs);
  const [draft, setDraft] = useState<DrinkDraft | null>(null);
  const [busy, setBusy] = useState(false);

  // Pick up a draft produced by the label scanner.
  useFocusEffect(
    useCallback(() => {
      const scanned = useDraftStore.getState().draft;
      if (scanned) {
        setDraft(scanned);
        useDraftStore.getState().set(null);
      }
    }, [setDraft]),
  );

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const { repos, clock } = getServices();
      const beverageId = await ensureBeverage(repos, draft, clock.now());
      const r = await logDrink({
        beverage: { id: beverageId, name: draft.name, category: draft.category === 'custom' ? 'custom' : draft.category },
        measurement: measurementFromDraft(draft, def),
        consumedAt: draft.minutesAgo > 0 ? clock.now() - draft.minutesAgo * MINUTE_MS : undefined,
        source: draft.templateKey === 'label_scan' ? 'label_scan' : 'manual',
      });
      if (!r.ok) {
        Alert.alert('Couldn’t log this drink', r.errors.map((e) => e.message).join('\n'));
        return;
      }
      void qc.invalidateQueries({ queryKey: ['beverages'] });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <Screen edges={['top', 'bottom']}>
        <AppText variant="title2">Start an evening first</AppText>
        <AppText color={colors.textSecondary}>Drinks are recorded inside an evening session so Threshold can follow your pace.</AppText>
        <Button
          label="Start Evening"
          size="large"
          onPress={async () => {
            const r = await start();
            if (!r.ok) Alert.alert('Couldn’t start a session', r.errors[0]?.message ?? '');
          }}
        />
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (draft) {
    return (
      <Screen
        edges={['top', 'bottom']}
        footer={
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Back" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button label="Log drink" onPress={submit} loading={busy} disabled={!draftIsValid(draft, def)} style={{ flex: 2 }} testID="confirm-log" />
          </View>
        }
      >
        <AppText variant="title2" accessibilityRole="header">
          {draft.name || 'Custom drink'}
        </AppText>
        <DraftEditor draft={draft} onChange={setDraft} def={def} allowTime editableName={draft.templateKey === null || draft.templateKey === 'label_scan'} />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="title2" accessibilityRole="header">
          Log a drink
        </AppText>
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Custom drink" variant="secondary" onPress={() => setDraft({ ...BLANK, serving: prefs.unitSystem === 'metric' ? { value: 330, unit: 'ml' } : BLANK.serving })} style={{ flex: 1 }} />
        {featureFlags.labelScanning ? <Button label="Scan label" variant="secondary" onPress={() => router.push('/scan-label')} style={{ flex: 1 }} /> : null}
      </View>

      {(recent.data ?? []).length > 0 ? (
        <>
          <SectionHeader title="Recent" />
          <Card>
            {(recent.data ?? []).map((b) => (
              <ListRow key={b.id} title={b.name} subtitle={`${describeServing(b.defaultServing)}${b.abvPercent !== null ? ` · ${b.abvPercent}%` : ''}`} onPress={() => setDraft(draftFromBeverage(b))} />
            ))}
          </Card>
        </>
      ) : null}

      {GROUPS.map((g) => (
        <View key={g} style={{ gap: spacing.sm }}>
          <SectionHeader title={CATEGORY_LABELS[g]} />
          <Card>
            {BEVERAGE_TEMPLATES.filter((t) => t.category === g).map((t) => (
              <ListRow
                key={t.key}
                title={t.name}
                subtitle={`${describeServing(t.defaultServing)}${t.abvPercent !== null ? ` · ${t.abvPercent}%` : t.typicalRecipe ? ' · typical recipe' : ' · strength unknown'}`}
                onPress={() => setDraft(draftFromTemplate(t))}
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
