import { describe, expect, it } from 'vitest';
import { fromMillilitres, ML_PER_UNIT, roundTo, toMillilitres, usProofToAbvPercent, formatVolume } from '../src';
import type { VolumeUnit } from '@threshold/shared-types';

describe('unit conversions', () => {
  it('uses exact legal definitions for fluid ounces', () => {
    expect(ML_PER_UNIT.fl_oz_us).toBe(29.5735295625);
    expect(ML_PER_UNIT.fl_oz_imp).toBe(28.4130625);
  });

  it('converts to millilitres', () => {
    expect(toMillilitres({ value: 1.75, unit: 'l' })).toBe(1750);
    expect(toMillilitres({ value: 33, unit: 'cl' })).toBe(330);
    expect(toMillilitres({ value: 12, unit: 'fl_oz_us' })).toBeCloseTo(354.88235475, 9);
  });

  it('round-trips every unit', () => {
    for (const unit of Object.keys(ML_PER_UNIT) as VolumeUnit[]) {
      expect(fromMillilitres(toMillilitres({ value: 7.3, unit }), unit)).toBeCloseTo(7.3, 12);
    }
  });

  it('rejects invalid volumes and units', () => {
    expect(() => toMillilitres({ value: -5, unit: 'ml' })).toThrow(RangeError);
    expect(() => toMillilitres({ value: Number.POSITIVE_INFINITY, unit: 'ml' })).toThrow(RangeError);
    expect(() => toMillilitres({ value: 5, unit: 'pint' as VolumeUnit })).toThrow(RangeError);
  });

  it('converts US proof to ABV', () => {
    expect(usProofToAbvPercent(80)).toBe(40);
    expect(() => usProofToAbvPercent(250)).toThrow();
  });

  it('rounds for display without float artefacts', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(formatVolume({ value: 12, unit: 'fl_oz_us' })).toBe('12 fl oz');
  });
});
