import { STANDARD_DRINK_DEFINITIONS, emergencyNumberFor } from '@threshold/core';
import type { NotificationFrequency, StandardDrinkRegion, UnitSystem } from '@threshold/shared-types';
import { AppText, Card, ChoiceList, Screen, SectionHeader, SegmentedControl, Stepper, ToggleRow } from '../../components/ui';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

const REGIONS = Object.keys(STANDARD_DRINK_DEFINITIONS) as Exclude<StandardDrinkRegion, 'CUSTOM'>[];
const COUNTRIES = ['US', 'CA', 'MX', 'GB', 'IE', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'JP', 'KR', 'IN', 'BR', 'ZA'];

export default function Preferences() {
  const prefs = useAppStore((s) => s.preferences);
  const save = useAppStore((s) => s.savePreferences);
  return (
    <Screen edges={[]}>
      <SectionHeader title="Reminders" />
      <Card>
        <SegmentedControl<NotificationFrequency>
          accessibilityLabel="Reminder frequency"
          options={[
            { value: 'minimal', label: 'Minimal' },
            { value: 'standard', label: 'Standard' },
            { value: 'frequent', label: 'Frequent' },
          ]}
          value={prefs.notificationFrequency}
          onChange={(notificationFrequency) => void save({ notificationFrequency })}
        />
        <AppText variant="footnote" color={colors.textSecondary}>
          Minimal: only pace and personal-goal reminders, at most every 30 min. Standard adds suggestions to switch drinks. Frequent adds physiology and recovery notes.
        </AppText>
        <ToggleRow
          label="Quiet mode"
          description="During sessions, only reminders about goals you set are delivered."
          value={prefs.quietMode}
          onValueChange={(quietMode) => void save({ quietMode })}
        />
      </Card>

      <SectionHeader title="Standard drink definition" />
      <ChoiceList
        options={REGIONS.map((r) => ({ value: r, label: r, description: `${STANDARD_DRINK_DEFINITIONS[r].gramsEthanol} g per ${STANDARD_DRINK_DEFINITIONS[r].label}` }))}
        selected={prefs.standardDrinkRegion === 'CUSTOM' ? [] : [prefs.standardDrinkRegion]}
        onToggle={(standardDrinkRegion) => void save({ standardDrinkRegion })}
      />
      <AppText variant="footnote" color={colors.textTertiary}>
        Changing this re-expresses totals; the grams of alcohol you logged never change.
      </AppText>

      <SectionHeader title="Units" />
      <SegmentedControl<UnitSystem>
        accessibilityLabel="Units"
        options={[
          { value: 'us_customary', label: 'fl oz' },
          { value: 'metric', label: 'mL' },
        ]}
        value={prefs.unitSystem}
        onChange={(unitSystem) => void save({ unitSystem })}
      />

      <SectionHeader title="Day boundary" />
      <Card>
        <Stepper
          label="New day starts at"
          value={prefs.dayBoundaryHour}
          min={0}
          max={8}
          onChange={(v) => void save({ dayBoundaryHour: v ?? 0 })}
          format={(v) => `${v}:00`}
        />
        <AppText variant="footnote" color={colors.textSecondary}>
          Drinks before this hour count toward the previous evening for daily totals and alcohol-free days.
        </AppText>
      </Card>

      <SectionHeader title="Emergency number" />
      <ChoiceList
        options={COUNTRIES.map((c) => ({ value: c, label: c, description: `Call ${emergencyNumberFor(c).primary}` }))}
        selected={[prefs.emergencyCountry]}
        onToggle={(emergencyCountry) => void save({ emergencyCountry })}
      />
    </Screen>
  );
}
