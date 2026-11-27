import { assertSafeMessage, roundTo, type AssociationResult } from '@threshold/core';

/**
 * Turns descriptive associations into careful, correlation-only sentences. Returns null when
 * there is not enough data — Threshold never fills gaps with generic claims or percentages.
 */
export function describeAssociation(
  r: AssociationResult,
  wording: { exposureHigh: string; outcome: string; higherIsBetter: boolean },
): string | null {
  if (r.status !== 'computed' || !r.lowerGroup || !r.higherGroup) return null;
  const diff = r.higherGroup.meanOutcome - r.lowerGroup.meanOutcome;
  if (Math.abs(diff) < 0.75) {
    return assertSafeMessage(
      `So far, ${wording.exposureHigh} haven’t shown a clear difference in your reported ${wording.outcome} (${r.n} sessions).`,
    );
  }
  const worse = wording.higherIsBetter ? diff < 0 : diff > 0;
  const direction = worse ? 'poorer' : 'better';
  return assertSafeMessage(
    `Your previous sessions with ${wording.exposureHigh} have been associated with ${direction} reported ${wording.outcome} ` +
      `(average ${roundTo(r.higherGroup.meanOutcome, 1)} vs ${roundTo(r.lowerGroup.meanOutcome, 1)} out of 10, ${r.n} sessions). ` +
      'This is a pattern in your own records, not proof of cause.',
  );
}
