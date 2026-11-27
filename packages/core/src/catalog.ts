import type { BeverageCategory, VolumeInput } from '@threshold/shared-types';
import type { AlcoholicComponent } from './alcohol';

/**
 * Built-in beverage templates. ABV values are typical label values; every template can be
 * edited at log time and `abvVaries` marks items whose strength differs widely by product.
 * Cocktail templates use a *typical recipe* and are therefore logged as `estimated`.
 */
export interface BeverageTemplate {
  key: string;
  name: string;
  category: BeverageCategory;
  defaultServing: VolumeInput;
  abvPercent: number | null;
  abvVaries: boolean;
  typicalRecipe?: AlcoholicComponent[];
}

const oz = (value: number): VolumeInput => ({ value, unit: 'fl_oz_us' });
const ml = (value: number): VolumeInput => ({ value, unit: 'ml' });

export const BEVERAGE_TEMPLATES: readonly BeverageTemplate[] = Object.freeze([
  // Beer
  { key: 'beer_regular_12oz', name: 'Beer (regular)', category: 'beer', defaultServing: oz(12), abvPercent: 5, abvVaries: true },
  { key: 'beer_light_12oz', name: 'Light beer', category: 'beer', defaultServing: oz(12), abvPercent: 4.2, abvVaries: true },
  { key: 'beer_ipa_12oz', name: 'IPA / craft beer', category: 'beer', defaultServing: oz(12), abvPercent: 6.5, abvVaries: true },
  { key: 'beer_pint_us', name: 'Beer pint (US 16 oz)', category: 'beer', defaultServing: oz(16), abvPercent: 5, abvVaries: true },
  { key: 'beer_pint_uk', name: 'Beer pint (UK 568 mL)', category: 'beer', defaultServing: ml(568), abvPercent: 4.5, abvVaries: true },
  // Wine
  { key: 'wine_red_5oz', name: 'Red wine', category: 'wine', defaultServing: oz(5), abvPercent: 13.5, abvVaries: true },
  { key: 'wine_white_5oz', name: 'White wine', category: 'wine', defaultServing: oz(5), abvPercent: 12, abvVaries: true },
  { key: 'wine_sparkling_5oz', name: 'Sparkling wine', category: 'wine', defaultServing: oz(5), abvPercent: 12, abvVaries: true },
  { key: 'wine_large_9oz', name: 'Large glass of wine', category: 'wine', defaultServing: oz(9), abvPercent: 13, abvVaries: true },
  // Spirits
  { key: 'spirit_shot_1_5oz', name: 'Spirit shot (40%)', category: 'spirits', defaultServing: oz(1.5), abvPercent: 40, abvVaries: false },
  { key: 'spirit_double_3oz', name: 'Double spirit (40%)', category: 'spirits', defaultServing: oz(3), abvPercent: 40, abvVaries: false },
  // Seltzer / cider
  { key: 'seltzer_12oz', name: 'Hard seltzer', category: 'hard_seltzer', defaultServing: oz(12), abvPercent: 5, abvVaries: true },
  { key: 'cider_12oz', name: 'Hard cider', category: 'cider', defaultServing: oz(12), abvPercent: 5, abvVaries: true },
  // Mixed drinks & cocktails (typical recipes — logged as estimates)
  {
    key: 'mixed_highball',
    name: 'Highball (spirit + mixer)',
    category: 'mixed_drink',
    defaultServing: oz(8),
    abvPercent: null,
    abvVaries: true,
    typicalRecipe: [{ serving: oz(1.5), abvPercent: 40 }],
  },
  {
    key: 'cocktail_margarita',
    name: 'Margarita',
    category: 'cocktail',
    defaultServing: oz(6),
    abvPercent: null,
    abvVaries: true,
    typicalRecipe: [
      { serving: oz(2), abvPercent: 40 },
      { serving: oz(1), abvPercent: 40 },
    ],
  },
  {
    key: 'cocktail_martini',
    name: 'Martini',
    category: 'cocktail',
    defaultServing: oz(3),
    abvPercent: null,
    abvVaries: true,
    typicalRecipe: [
      { serving: oz(2.5), abvPercent: 40 },
      { serving: oz(0.5), abvPercent: 18 },
    ],
  },
  { key: 'cocktail_unknown', name: 'Cocktail (unknown recipe)', category: 'cocktail', defaultServing: oz(6), abvPercent: null, abvVaries: true },
  // Non-alcoholic
  { key: 'na_beer_12oz', name: 'Non-alcoholic beer', category: 'nonalcoholic', defaultServing: oz(12), abvPercent: 0.5, abvVaries: true },
  { key: 'na_mocktail', name: 'Mocktail / soft drink', category: 'nonalcoholic', defaultServing: oz(8), abvPercent: 0, abvVaries: false },
  { key: 'water_glass', name: 'Water', category: 'water', defaultServing: oz(8), abvPercent: 0, abvVaries: false },
]);

export function findTemplate(key: string): BeverageTemplate | undefined {
  return BEVERAGE_TEMPLATES.find((t) => t.key === key);
}

export const CATEGORY_LABELS: Readonly<Record<BeverageCategory, string>> = Object.freeze({
  beer: 'Beer',
  wine: 'Wine',
  spirits: 'Spirits',
  cocktail: 'Cocktail',
  hard_seltzer: 'Hard seltzer',
  cider: 'Cider',
  mixed_drink: 'Mixed drink',
  nonalcoholic: 'Non-alcoholic',
  water: 'Water',
  custom: 'Custom',
});
