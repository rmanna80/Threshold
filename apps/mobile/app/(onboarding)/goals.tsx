import type { ModerationObjective } from '@threshold/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { AppText, Card, ChoiceList, SectionHeader, Stepper } from '../../components/ui';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { OBJECTIVE_OPTIONS } from '../../features/onboarding/options';
import { definitionFor } from '../../lib/format';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';


export default function Goals() {
  const goals = useAppStore((s) => s.goals);
  const prefs = useAppStore((s) => s.preferences);
  const saveGoals = useAppStore((s) => s.saveGoals);
  const def = definitionFor(prefs);
  const [objectives, setObjectives] = useState<ModerationObjective[]>(goals.objectives);
  const [perSession, setPerSession] = useState<number | null>(goals.maxStandardDrinksPerSession);
  const [perWeek, setPerWeek] = useState<number | null>(goals.maxStandardDrinksPerWeek);
  const [afDays, setAfDays] = useState<number | null>(goals.alcoholFreeDaysPerWeek);
  const [pace, setPace] = useState<number | null>(goals.paceGoalMinutesBetweenDrinks);
  const [error, setError] = useState<string | null>(null);

  const toggle = (v: ModerationObjective) =>
    setObjectives((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const onContinue = async () => {
    const issues = await saveGoals({
      objectives,
      maxStandardDrinksPerSession: perSession,
      maxStandardDrinksPerWeek: perWeek,
      alcoholFreeDaysPerWeek: afDays,
      paceGoalMinutesBetweenDrinks: pace,
    });
    if (issues.length) setError(issues.map((i) => i.message).join(' '));
    else router.push('/habits');
  };

  return (
    <OnboardingStep step="goals" title="What would you like to change?" subtitle="Choose any that apply. You can change these at any time." onPrimary={onContinue}>
      <ChoiceList options={OBJECTIVE_OPTIONS} selected={objectives} onToggle={toggle} multiple />
      <SectionHeader title="Personal goals (optional)" />
      <Card>
        <AppText variant="footnote" color={colors.textSecondary}>
          These are your own targets, not medical safety limits. Threshold will remind you when you reach them.
        </AppText>
        <Stepper label={`Max ${def.labelPlural} per evening`} value={perSession} onChange={setPerSession} min={0} max={30} step={0.5} allowNull />
        <Stepper label={`Max ${def.labelPlural} per week`} value={perWeek} onChange={setPerWeek} min={0} max={100} allowNull />
        <Stepper label="Alcohol-free days per week" value={afDays} onChange={setAfDays} min={0} max={7} allowNull />
        <Stepper
          label="Pace reminder spacing"
          value={pace}
          onChange={setPace}
          min={15}
          max={240}
          step={15}
          allowNull
          format={(v) => `${v} min`}
        />
        <AppText variant="footnote" color={colors.textTertiary}>
          Pace reminders nudge you if drinks are logged closer together than you’d like. Threshold never counts down to your next drink.
        </AppText>
      </Card>
      {error ? <AppText color={colors.safety}>{error}</AppText> : null}
    </OnboardingStep>
  );
}
