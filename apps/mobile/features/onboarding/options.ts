import type { ModerationObjective } from '@threshold/shared-types';

export const OBJECTIVE_OPTIONS: { value: ModerationObjective; label: string; description: string }[] = [
  { value: 'reduce_frequency', label: 'Drink less often', description: 'Fewer drinking days each week.' },
  { value: 'reduce_per_session', label: 'Drink less per evening', description: 'Set a personal limit for a session.' },
  { value: 'avoid_fast_drinking', label: 'Slow down', description: 'Reminders when drinks are close together.' },
  { value: 'improve_recovery', label: 'Feel better the next day', description: 'Track how evenings affect mornings.' },
  { value: 'understand_sleep', label: 'Understand my sleep', description: 'See sleep patterns around drinking.' },
  { value: 'athletic_recovery', label: 'Protect training recovery', description: 'Relate drinking to recovery signals.' },
  { value: 'alcohol_free_days', label: 'Alcohol-free days', description: 'Plan and celebrate days without alcohol.' },
];

