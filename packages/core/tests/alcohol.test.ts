import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/alcohol.json';
import {
  ETHANOL_DENSITY_G_PER_ML,
  ethanolGrams,
  measureDrink,
  resolveStandardDrinkDefinition,
  standardDrinksFromGrams,
  convertStandardDrinks,
} from '../src';
import type { StandardDrinkRegion, VolumeUnit } from '@threshold/shared-types';

describe('ethanol mathematics', () => {
  it('uses ethanol density 0.789 g/mL', () => {
    expect(ETHANOL_DENSITY_G_PER_ML).toBe(0.789);
    expect(vectors.ethanolDensity).toBe(ETHANOL_DENSITY_G_PER_ML);
  });

  it('computes grams = ml × abv × 0.789', () => {
    expect(ethanolGrams(100, 10)).toBeCloseTo(7.89, 12);
    expect(ethanolGrams(0, 40)).toBe(0);
    expect(ethanolGrams(500, 0)).toBe(0);
  });

  it('rejects invalid numeric input instead of guessing', () => {
    expect(() => ethanolGrams(-1, 5)).toThrow(RangeError);
    expect(() => ethanolGrams(100, 101)).toThrow(RangeError);
    expect(() => ethanolGrams(Number.NaN, 5)).toThrow(RangeError);
    expect(() => standardDrinksFromGrams(14, 0)).toThrow(RangeError);
  });

  it('converts grams to standard drinks', () => {
    expect(standardDrinksFromGrams(28, 14)).toBe(2);
    expect(standardDrinksFromGrams(8, 8)).toBe(1);
  });
});

describe('cross-language vectors (valid)', () => {
  for (const c of vectors.valid) {
    it(c.name, () => {
      const definition = resolveStandardDrinkDefinition(c.input.region as StandardDrinkRegion);
      const result = measureDrink({
        serving: { value: c.input.serving.value, unit: c.input.serving.unit as VolumeUnit },
        abvPercent: c.input.abvPercent,
        fractionConsumed: c.input.fractionConsumed,
        definition,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const v = result.value;
      expect(v.servingMl).toBeCloseTo(c.expected.servingMl, 9);
      expect(v.consumedMl).toBeCloseTo(c.expected.consumedMl, 9);
      expect(v.ethanolGrams).not.toBeNull();
      expect(v.ethanolGrams!).toBeCloseTo(c.expected.ethanolGrams, 9);
      expect(v.standardDrinks!).toBeCloseTo(c.expected.standardDrinks, 9);
      expect(v.standardDrinkGrams).toBe(c.expected.standardDrinkGrams);
      expect(v.confirmation).toBe('user_confirmed');
      // Original input is preserved verbatim next to normalized values.
      expect(v.servingInput).toEqual(c.input.serving);
    });
  }
});

describe('cross-language vectors (invalid)', () => {
  for (const c of vectors.invalid) {
    it(c.name, () => {
      const result = measureDrink({
        serving: { value: c.input.serving.value, unit: c.input.serving.unit as VolumeUnit },
        abvPercent: c.input.abvPercent,
        fractionConsumed: c.input.fractionConsumed,
        definition: resolveStandardDrinkDefinition('US'),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((e) => e.code)).toContain(c.expectedErrorCode);
    });
  }
});

describe('missing and uncertain quantities', () => {
  const US = resolveStandardDrinkDefinition('US');

  it('does not assume ABV when unknown', () => {
    const r = measureDrink({ serving: { value: 6, unit: 'fl_oz_us' }, abvPercent: null, fractionConsumed: 1, definition: US });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ethanolGrams).toBeNull();
    expect(r.value.standardDrinks).toBeNull();
    expect(r.value.confirmation).toBe('estimated');
    expect(r.value.uncertainty.abvKnown).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain('abv_unknown');
  });

  it('uses the midpoint of a user estimate, scaled by portion, and keeps the range', () => {
    const r = measureDrink({
      serving: { value: 6, unit: 'fl_oz_us' },
      abvPercent: null,
      fractionConsumed: 0.5,
      estimatedStandardDrinks: { low: 1, high: 3 },
      definition: US,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standardDrinks).toBeCloseTo(1, 12);
    expect(r.value.uncertainty.standardDrinksLow).toBeCloseTo(0.5, 12);
    expect(r.value.uncertainty.standardDrinksHigh).toBeCloseTo(1.5, 12);
    expect(r.value.confirmation).toBe('estimated');
  });

  it('rejects inverted estimate ranges', () => {
    const r = measureDrink({
      serving: { value: 6, unit: 'fl_oz_us' },
      abvPercent: null,
      fractionConsumed: 1,
      estimatedStandardDrinks: { low: 3, high: 1 },
      definition: US,
    });
    expect(r.ok).toBe(false);
  });

  it('computes cocktails from components and flags typical recipes as estimates', () => {
    const r = measureDrink({
      serving: { value: 6, unit: 'fl_oz_us' },
      abvPercent: null,
      fractionConsumed: 1,
      components: [
        { serving: { value: 2, unit: 'fl_oz_us' }, abvPercent: 40 },
        { serving: { value: 1, unit: 'fl_oz_us' }, abvPercent: 40 },
      ],
      compositionIsTypicalRecipe: true,
      definition: US,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expectedGrams = 3 * 29.5735295625 * 0.4 * 0.789;
    expect(r.value.ethanolGrams!).toBeCloseTo(expectedGrams, 9);
    expect(r.value.abvPercent!).toBeCloseTo(20, 9);
    expect(r.value.confirmation).toBe('estimated');
  });

  it('rejects components that exceed the serving volume', () => {
    const r = measureDrink({
      serving: { value: 2, unit: 'fl_oz_us' },
      abvPercent: null,
      fractionConsumed: 1,
      components: [{ serving: { value: 3, unit: 'fl_oz_us' }, abvPercent: 40 }],
      definition: US,
    });
    expect(r.ok).toBe(false);
  });

  it('re-expresses grams under another regional definition', () => {
    expect(convertStandardDrinks(16, resolveStandardDrinkDefinition('UK'))).toBe(2);
    expect(convertStandardDrinks(null, US)).toBeNull();
  });

  it('validates custom standard drink definitions', () => {
    expect(resolveStandardDrinkDefinition('CUSTOM', 12).gramsEthanol).toBe(12);
    expect(() => resolveStandardDrinkDefinition('CUSTOM', null)).toThrow();
    expect(() => resolveStandardDrinkDefinition('CUSTOM', 2)).toThrow();
  });
});
