import { fromMillilitres, resolveStandardDrinkDefinition, roundTo } from '@threshold/core';
import type { StandardDrinkDefinition, UserPreferences, VolumeInput } from '@threshold/shared-types';

export function definitionFor(prefs: Pick<UserPreferences, 'standardDrinkRegion' | 'customStandardDrinkGrams'>): StandardDrinkDefinition {
  try {
    return resolveStandardDrinkDefinition(prefs.standardDrinkRegion, prefs.customStandardDrinkGrams);
  } catch {
    return resolveStandardDrinkDefinition('US');
  }
}

/** "1.5 standard drinks" / "1 unit". One decimal, trailing zero trimmed. */
export function formatStandardDrinks(value: number, def: StandardDrinkDefinition): string {
  const v = roundTo(value, 1);
  return `${v} ${v === 1 ? def.label : def.labelPlural}`;
}

export function formatNumber(value: number, digits = 1): string {
  return String(roundTo(value, digits));
}

export function formatGrams(value: number): string {
  return `${roundTo(value, 1)} g`;
}

export function displayVolume(ml: number, unitSystem: UserPreferences['unitSystem']): string {
  if (unitSystem === 'us_customary') return `${roundTo(fromMillilitres(ml, 'fl_oz_us'), 1)} fl oz`;
  return ml >= 1000 ? `${roundTo(ml / 1000, 2)} L` : `${Math.round(ml)} mL`;
}

export function describeServing(v: VolumeInput): string {
  const labels = { ml: 'mL', cl: 'cL', l: 'L', fl_oz_us: 'fl oz', fl_oz_imp: 'imp fl oz' } as const;
  return `${roundTo(v.value, 2)} ${labels[v.unit]}`;
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
