import { findTemplate, type BeverageTemplate, type DrinkMeasurementInput } from '@threshold/core';
import type { Beverage, BeverageCategory, StandardDrinkDefinition, VolumeInput } from '@threshold/shared-types';
import { newId } from '@threshold/core';
import type { Repositories } from '../../database/repositories';

/** The editable draft shown in the logging sheet before anything is saved. */
export interface DrinkDraft {
  beverageId: string | null;
  templateKey: string | null;
  name: string;
  category: BeverageCategory;
  serving: VolumeInput;
  abvPercent: number | null;
  fractionConsumed: number;
  /** Use the template's typical recipe (cocktails) — logged as an estimate. */
  useTypicalRecipe: boolean;
  estimate: { low: number; high: number } | null;
  minutesAgo: number;
}

export function draftFromTemplate(t: BeverageTemplate): DrinkDraft {
  return {
    beverageId: null,
    templateKey: t.key,
    name: t.name,
    category: t.category,
    serving: { ...t.defaultServing },
    abvPercent: t.abvPercent,
    fractionConsumed: 1,
    useTypicalRecipe: Boolean(t.typicalRecipe),
    estimate: null,
    minutesAgo: 0,
  };
}

export function draftFromBeverage(b: Beverage): DrinkDraft {
  return {
    beverageId: b.id,
    templateKey: null,
    name: b.name,
    category: b.category,
    serving: { ...b.defaultServing },
    abvPercent: b.abvPercent,
    fractionConsumed: 1,
    useTypicalRecipe: false,
    estimate: null,
    minutesAgo: 0,
  };
}

export function measurementFromDraft(d: DrinkDraft, definition: StandardDrinkDefinition): DrinkMeasurementInput {
  const template = d.templateKey ? findTemplate(d.templateKey) : undefined;
  const recipe = d.useTypicalRecipe && d.abvPercent === null ? template?.typicalRecipe ?? null : null;
  return {
    serving: d.serving,
    fractionConsumed: d.fractionConsumed,
    abvPercent: recipe ? null : d.abvPercent,
    components: recipe,
    compositionIsTypicalRecipe: Boolean(recipe),
    estimatedStandardDrinks: !recipe && d.abvPercent === null ? d.estimate : null,
    definition,
  };
}

/**
 * Persist the beverage so it appears under "Recent". Template beverages are stored once and
 * reused; edits to serving/ABV at log time don't overwrite the stored beverage.
 */
export async function ensureBeverage(repos: Repositories, d: DrinkDraft, now: number): Promise<string> {
  if (d.beverageId) return d.beverageId;
  const existing = await repos.beverages.findByName(d.name, d.category);
  if (existing) return existing.id;
  const b: Beverage = {
    id: newId(),
    name: d.name.trim() || 'Drink',
    category: d.category,
    defaultServing: d.serving,
    abvPercent: d.abvPercent,
    isCustom: d.templateKey === null,
    abvVaries: d.templateKey ? Boolean(findTemplate(d.templateKey)?.abvVaries) : false,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
  };
  await repos.beverages.upsert(b);
  return b.id;
}
