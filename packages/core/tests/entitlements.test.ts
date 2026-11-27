import { describe, expect, it } from 'vitest';
import { ALWAYS_FREE_FEATURES, PAID_TIER_CANDIDATES, canUse, type EntitlementState } from '../src/entitlements';

const states: EntitlementState[] = [{ kind: 'free' }, { kind: 'unknown' }, { kind: 'plus', expiresAt: 0 }, { kind: 'plus', expiresAt: null }];

describe('entitlements', () => {
  it('never gates safety and core moderation features, in any state', () => {
    for (const feature of ALWAYS_FREE_FEATURES) {
      for (const state of states) {
        for (const subscriptionsEnabled of [true, false]) {
          expect(canUse(feature, { subscriptionsEnabled, state, now: 1_000 })).toBe(true);
        }
      }
    }
  });

  it('keeps the free and paid lists disjoint', () => {
    for (const f of PAID_TIER_CANDIDATES) expect(ALWAYS_FREE_FEATURES.has(f)).toBe(false);
  });

  it('with billing disabled (this build) every feature is available', () => {
    for (const f of PAID_TIER_CANDIDATES) expect(canUse(f, { subscriptionsEnabled: false, state: { kind: 'free' }, now: 0 })).toBe(true);
  });

  it('if billing were enabled, paid features follow the entitlement and expiry', () => {
    const ctx = (state: EntitlementState) => ({ subscriptionsEnabled: true, state, now: 1_000 });
    expect(canUse('long_range_trends', ctx({ kind: 'free' }))).toBe(false);
    expect(canUse('long_range_trends', ctx({ kind: 'plus', expiresAt: 2_000 }))).toBe(true);
    expect(canUse('long_range_trends', ctx({ kind: 'plus', expiresAt: 500 }))).toBe(false);
  });
});
