import type { ModerationObjective } from '@threshold/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Card, ChoiceList, Screen, SectionHeader, Stepper } from '../../components/ui';
import { OBJECTIVE_OPTIONS } from '../../features/onboarding/options';
import { definitionFor } from '../../lib/format';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

export default function GoalsSettings() {
  const goals = useAppStore((s) => s.goals);
  const prefs = useAppStore((s) => s.preferences);
  const saveGoals = useAppStore((s) => s.saveGoals);
  const def = definitionFor(prefs);
  const [objectives, setObjectives] = useState<ModerationObjective[]>(goals.objectives);
  const [perSession, setPerSession] = useState(goals.maxStandardDrinksPerSession);
  const [perWeek, setPerWeek] = useState(goals.maxStandardDrinksPerWeek);
  const [afDays, setAfDays] = useState(goals.alcoholFreeDaysPerWeek);
  const [pace, setPace] = useState(goals.paceGoalMinutesBetweenDrinks);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const issues = await saveGoals({
      objectives,
      maxStandardDrinksPerSession: perSession,
      maxStandardDrinksPerWeek: perWeek,
      alcoholFreeDaysPerWeek: afDays,
      paceGoalMinutesBetweenDrinks: pace,
    });
    if (issues.length) setError(issues.map((i) => i.message).join(' '));
    else router.back();
  };

  return (
    <Screen edges={[]} footer={<Button label="Save goals" onPress={save} size="large" />}>
      <SectionHeader title="What matters to you" />
      <ChoiceList options={OBJECTIVE_OPTIONS} selected={objectives} onToggle={(v) => setObjectives((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]))} multiple />
      <SectionHeader title="Personal goals" />
      <Card>
        <AppText variant="footnote" color={colors.textSecondary}>
          Your own targets — not medical safety limits. A new session keeps the goal that was set when it started.
        </AppText>
        <Stepper label={`Max ${def.labelPlural} per evening`} value={perSession} onChange={setPerSession} min={0} max={30} step={0.5} allowNull />
        <Stepper label={`Max ${def.labelPlural} per week`} value={perWeek} onChange={setPerWeek} min={0} max={100} allowNull />
        <Stepper label="Alcohol-free days per week" value={afDays} onChange={setAfDays} min={0} max={7} allowNull />
        <Stepper label="Pace reminder spacing" value={pace} onChange={setPace} min={15} max={240} step={15} allowNull format={(v) => `${v} min`} />
      </Card>
      {error ? <AppText color={colors.safety}>{error}</AppText> : null}
    </Screen>
  );
}
