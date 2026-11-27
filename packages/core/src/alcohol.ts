import type {
  ConfirmationState,
  DrinkUncertainty,
  StandardDrinkDefinition,
  ValidationIssue,
  VolumeInput,
  Result,
} from '@threshold/shared-types';
import { isVolumeUnit, toMillilitres } from './units';

/** Density of ethanol at 20 °C, g/mL. */
export const ETHANOL_DENSITY_G_PER_ML = 0.789;

/** Hard upper bound for a single logged serving. Larger values are rejected, never truncated. */
export const MAX_SERVING_ML = 5000;
/** Upper bound for a user-supplied standard drink estimate for a single drink. */
export const MAX_ESTIMATED_STANDARD_DRINKS = 20;

/**
 * ethanol_grams = beverage_volume_ml × (abv_percent / 100) × 0.789
 */
export function ethanolGrams(volumeMl: number, abvPercent: number): number {
  if (!Number.isFinite(volumeMl) || volumeMl < 0) {
    throw new RangeError(`volumeMl must be finite and >= 0 (got ${volumeMl})`);
  }
  if (!Number.isFinite(abvPercent) || abvPercent < 0 || abvPercent > 100) {
    throw new RangeError(`abvPercent must be within [0, 100] (got ${abvPercent})`);
  }
  return volumeMl * (abvPercent / 100) * ETHANOL_DENSITY_G_PER_ML;
}

/** standard_drinks = ethanol_grams / grams_per_standard_drink */
export function standardDrinksFromGrams(grams: number, gramsPerStandardDrink: number): number {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new RangeError(`grams must be finite and >= 0 (got ${grams})`);
  }
  if (!Number.isFinite(gramsPerStandardDrink) || gramsPerStandardDrink <= 0) {
    throw new RangeError(`gramsPerStandardDrink must be > 0 (got ${gramsPerStandardDrink})`);
  }
  return grams / gramsPerStandardDrink;
}

export interface AlcoholicComponent {
  serving: VolumeInput;
  abvPercent: number;
}

export interface DrinkMeasurementInput {
  /** Total serving volume as entered by the user. */
  serving: VolumeInput;
  /** Portion actually consumed, 0 < f <= 1. Required — never defaulted silently. */
  fractionConsumed: number;
  /** ABV of the whole serving, if known. Ignored when `components` is provided. */
  abvPercent: number | null;
  /** Known alcoholic components (e.g. cocktail recipe). Mixers need not be listed. */
  components?: AlcoholicComponent[] | null;
  /** When composition is unknown, the user may supply a standard-drink range for the full serving. */
  estimatedStandardDrinks?: { low: number; high: number } | null;
  /** Whether the composition came from a generic recipe rather than the actual pour. */
  compositionIsTypicalRecipe?: boolean;
  definition: StandardDrinkDefinition;
}

export interface DrinkMeasurement {
  servingInput: VolumeInput;
  servingMl: number;
  fractionConsumed: number;
  consumedMl: number;
  /** Effective ABV of the serving; null if unknown. */
  abvPercent: number | null;
  ethanolGrams: number | null;
  standardDrinks: number | null;
  standardDrinkGrams: number;
  confirmation: Extract<ConfirmationState, 'user_confirmed' | 'estimated'>;
  uncertainty: DrinkUncertainty;
}

function issue(field: string, code: string, message: string): ValidationIssue {
  return { field, code, message };
}

/**
 * Deterministically measure a drink. Never fills in missing values: when alcohol content is
 * unknown the result carries `ethanolGrams = null` plus an explicit warning.
 */
export function measureDrink(input: DrinkMeasurementInput): Result<DrinkMeasurement> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!input.serving || !isVolumeUnit(input.serving.unit)) {
    errors.push(issue('serving.unit', 'invalid_unit', 'Choose a supported volume unit.'));
  }
  if (!input.serving || !Number.isFinite(input.serving.value) || input.serving.value <= 0) {
    errors.push(issue('serving.value', 'invalid_volume', 'Serving volume must be greater than zero.'));
  }
  if (!Number.isFinite(input.fractionConsumed) || input.fractionConsumed <= 0 || input.fractionConsumed > 1) {
    errors.push(issue('fractionConsumed', 'invalid_fraction', 'Portion consumed must be between 0 and 100%.'));
  }
  if (input.abvPercent !== null && (!Number.isFinite(input.abvPercent) || input.abvPercent < 0 || input.abvPercent > 100)) {
    errors.push(issue('abvPercent', 'invalid_abv', 'Alcohol by volume must be between 0% and 100%.'));
  }
  if (!input.definition || !(input.definition.gramsEthanol > 0)) {
    errors.push(issue('definition', 'invalid_definition', 'A standard drink definition is required.'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const servingMl = toMillilitres(input.serving);
  if (servingMl > MAX_SERVING_ML) {
    return {
      ok: false,
      errors: [issue('serving.value', 'implausible_volume', `A single serving above ${MAX_SERVING_ML} mL cannot be logged.`)],
    };
  }
  if (servingMl > 1500) {
    warnings.push(issue('serving.value', 'large_volume', 'This is a large serving. Please double-check the volume.'));
  }

  const consumedMl = servingMl * input.fractionConsumed;
  const gramsPerStd = input.definition.gramsEthanol;
  const components = input.components ?? null;
  const estimate = input.estimatedStandardDrinks ?? null;

  let effectiveAbv: number | null = null;
  let grams: number | null = null;
  let confirmation: DrinkMeasurement['confirmation'] = 'user_confirmed';
  const uncertainty: DrinkUncertainty = {
    abvKnown: false,
    volumeKnown: true,
    standardDrinksLow: null,
    standardDrinksHigh: null,
    note: null,
  };

  if (components && components.length > 0) {
    let componentEthanolMl = 0;
    let componentVolumeMl = 0;
    for (const [i, c] of components.entries()) {
      if (!isVolumeUnit(c.serving.unit) || !Number.isFinite(c.serving.value) || c.serving.value <= 0) {
        errors.push(issue(`components[${i}].serving`, 'invalid_volume', 'Component volume must be greater than zero.'));
        continue;
      }
      if (!Number.isFinite(c.abvPercent) || c.abvPercent < 0 || c.abvPercent > 100) {
        errors.push(issue(`components[${i}].abvPercent`, 'invalid_abv', 'Component ABV must be between 0% and 100%.'));
        continue;
      }
      const ml = toMillilitres(c.serving);
      componentVolumeMl += ml;
      componentEthanolMl += ml * (c.abvPercent / 100);
    }
    if (errors.length > 0) return { ok: false, errors };
    if (componentVolumeMl - servingMl > 1e-9) {
      return {
        ok: false,
        errors: [issue('components', 'components_exceed_serving', 'Alcoholic components exceed the total serving volume.')],
      };
    }
    effectiveAbv = (componentEthanolMl / servingMl) * 100;
    grams = ethanolGrams(consumedMl, effectiveAbv);
    uncertainty.abvKnown = true;
    if (input.compositionIsTypicalRecipe) {
      confirmation = 'estimated';
      uncertainty.note = 'Calculated from a typical recipe; actual pours vary.';
      warnings.push(issue('components', 'typical_recipe', 'Alcohol content is estimated from a typical recipe.'));
    }
  } else if (input.abvPercent !== null) {
    effectiveAbv = input.abvPercent;
    grams = ethanolGrams(consumedMl, effectiveAbv);
    uncertainty.abvKnown = true;
  } else if (estimate) {
    const { low, high } = estimate;
    if (
      !Number.isFinite(low) ||
      !Number.isFinite(high) ||
      low < 0 ||
      high < low ||
      high > MAX_ESTIMATED_STANDARD_DRINKS
    ) {
      return {
        ok: false,
        errors: [issue('estimatedStandardDrinks', 'invalid_estimate', 'Estimated range must satisfy 0 ≤ low ≤ high ≤ 20.')],
      };
    }
    // The user's range describes the full serving; scale by the portion consumed.
    const lowConsumed = low * input.fractionConsumed;
    const highConsumed = high * input.fractionConsumed;
    const mid = (lowConsumed + highConsumed) / 2;
    grams = mid * gramsPerStd;
    confirmation = 'estimated';
    uncertainty.standardDrinksLow = lowConsumed;
    uncertainty.standardDrinksHigh = highConsumed;
    uncertainty.note = 'User-estimated alcohol content (composition unknown).';
    warnings.push(issue('estimatedStandardDrinks', 'estimated', 'Totals use the midpoint of your estimate.'));
  } else {
    confirmation = 'estimated';
    uncertainty.note = 'Alcohol content unknown.';
    warnings.push(
      issue(
        'abvPercent',
        'abv_unknown',
        'Alcohol content is unknown. This drink is counted as a drink but not added to standard drink totals.',
      ),
    );
  }

  if (effectiveAbv !== null && effectiveAbv > 75) {
    warnings.push(issue('abvPercent', 'high_abv', 'This ABV is unusually high. Please double-check it.'));
  }

  return {
    ok: true,
    warnings,
    value: {
      servingInput: { value: input.serving.value, unit: input.serving.unit },
      servingMl,
      fractionConsumed: input.fractionConsumed,
      consumedMl,
      abvPercent: effectiveAbv,
      ethanolGrams: grams,
      standardDrinks: grams === null ? null : standardDrinksFromGrams(grams, gramsPerStd),
      standardDrinkGrams: gramsPerStd,
      confirmation,
      uncertainty,
    },
  };
}

/** Re-express a stored drink under a different standard-drink definition (e.g. region change). */
export function convertStandardDrinks(ethanolGramsValue: number | null, definition: StandardDrinkDefinition): number | null {
  if (ethanolGramsValue === null) return null;
  return standardDrinksFromGrams(ethanolGramsValue, definition.gramsEthanol);
}
