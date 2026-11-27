import type { VolumeInput, VolumeUnit } from '@threshold/shared-types';

/** Exact conversion factors to millilitres. */
export const ML_PER_UNIT: Readonly<Record<VolumeUnit, number>> = Object.freeze({
  ml: 1,
  cl: 10,
  l: 1000,
  /** US customary fluid ounce = 29.5735295625 mL (exact by definition). */
  fl_oz_us: 29.5735295625,
  /** Imperial fluid ounce = 28.4130625 mL (exact by definition). */
  fl_oz_imp: 28.4130625,
});

export const VOLUME_UNITS: readonly VolumeUnit[] = ['ml', 'cl', 'l', 'fl_oz_us', 'fl_oz_imp'];

export function isVolumeUnit(value: unknown): value is VolumeUnit {
  return typeof value === 'string' && (VOLUME_UNITS as readonly string[]).includes(value);
}

/** Convert any supported volume to millilitres. Throws on invalid input (never guesses). */
export function toMillilitres(volume: VolumeInput): number {
  if (!isVolumeUnit(volume.unit)) {
    throw new RangeError(`Unsupported volume unit: ${String(volume.unit)}`);
  }
  if (!Number.isFinite(volume.value) || volume.value < 0) {
    throw new RangeError(`Volume must be a finite, non-negative number (got ${volume.value})`);
  }
  return volume.value * ML_PER_UNIT[volume.unit];
}

export function fromMillilitres(ml: number, unit: VolumeUnit): number {
  if (!Number.isFinite(ml) || ml < 0) {
    throw new RangeError(`Millilitres must be a finite, non-negative number (got ${ml})`);
  }
  return ml / ML_PER_UNIT[unit];
}

/** US proof is twice the ABV percentage. */
export function usProofToAbvPercent(proof: number): number {
  if (!Number.isFinite(proof) || proof < 0 || proof > 200) {
    throw new RangeError(`US proof must be between 0 and 200 (got ${proof})`);
  }
  return proof / 2;
}

export function formatVolume(volume: VolumeInput, digits = 0): string {
  const labels: Record<VolumeUnit, string> = {
    ml: 'mL',
    cl: 'cL',
    l: 'L',
    fl_oz_us: 'fl oz',
    fl_oz_imp: 'imp fl oz',
  };
  const rounded = Number(volume.value.toFixed(digits));
  return `${rounded} ${labels[volume.unit]}`;
}

/** Round half away from zero to `digits` decimals without binary-float surprises for display. */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
}
