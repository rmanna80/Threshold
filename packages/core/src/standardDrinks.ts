import type { StandardDrinkDefinition, StandardDrinkRegion } from '@threshold/shared-types';

/**
 * Governmental standard drink definitions. Sources are documented in
 * research/alcohol-physiology.md and documentation/SCIENTIFIC_FOUNDATIONS.md.
 *
 * These are *measurement conventions*, not safety limits.
 */
export const STANDARD_DRINK_DEFINITIONS: Readonly<Record<Exclude<StandardDrinkRegion, 'CUSTOM'>, StandardDrinkDefinition>> =
  Object.freeze({
    US: {
      region: 'US',
      gramsEthanol: 14,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: 'NIAAA — "What is a standard drink?" (14 g pure alcohol)',
    },
    UK: {
      region: 'UK',
      gramsEthanol: 8,
      label: 'unit',
      labelPlural: 'units',
      source: 'NHS — one UK unit is 10 mL / 8 g of pure alcohol',
    },
    AU: {
      region: 'AU',
      gramsEthanol: 10,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: 'NHMRC Australian Guidelines (2020) — 10 g pure alcohol',
    },
    NZ: {
      region: 'NZ',
      gramsEthanol: 10,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: 'Health New Zealand / Te Whatu Ora — 10 g pure alcohol',
    },
    CA: {
      region: 'CA',
      gramsEthanol: 13.45,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: "CCSA — Canada's Guidance on Alcohol and Health (2023), 13.45 g pure alcohol",
    },
    IE: {
      region: 'IE',
      gramsEthanol: 10,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: 'HSE Ireland — 10 g pure alcohol',
    },
    AT: {
      region: 'AT',
      gramsEthanol: 20,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: 'Kalinowski & Humphreys, Addiction 2016;111(7):1293-1298 — Austria 20 g',
    },
  });

export const MIN_CUSTOM_STANDARD_DRINK_GRAMS = 5;
export const MAX_CUSTOM_STANDARD_DRINK_GRAMS = 30;

export function resolveStandardDrinkDefinition(
  region: StandardDrinkRegion,
  customGrams: number | null = null,
): StandardDrinkDefinition {
  if (region === 'CUSTOM') {
    if (
      customGrams === null ||
      !Number.isFinite(customGrams) ||
      customGrams < MIN_CUSTOM_STANDARD_DRINK_GRAMS ||
      customGrams > MAX_CUSTOM_STANDARD_DRINK_GRAMS
    ) {
      throw new RangeError(
        `Custom standard drink must be between ${MIN_CUSTOM_STANDARD_DRINK_GRAMS} and ${MAX_CUSTOM_STANDARD_DRINK_GRAMS} g`,
      );
    }
    return {
      region: 'CUSTOM',
      gramsEthanol: customGrams,
      label: 'standard drink',
      labelPlural: 'standard drinks',
      source: 'User-defined',
    };
  }
  return STANDARD_DRINK_DEFINITIONS[region];
}
