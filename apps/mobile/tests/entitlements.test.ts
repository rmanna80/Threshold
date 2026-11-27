import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ALWAYS_FREE_FEATURES, canUse } from '@threshold/core';
import { featureFlags } from '../config/featureFlags';
import { ROUTE_FEATURES, SAFETY_ROUTES } from '../config/routeFeatures';

function routes(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p, root);
    return name.endsWith('.tsx') ? [relative(root, p).replace(/\.tsx$/, '').split('\\').join('/')] : [];
  });
}

describe('route entitlements', () => {
  const all = routes(join(__dirname, '..', 'app'));

  it('classifies every screen', () => {
    expect(all.filter((r) => !(r in ROUTE_FEATURES))).toEqual([]);
  });

  it('safety routes map to always-free features and stay reachable in every entitlement state', () => {
    for (const r of SAFETY_ROUTES) {
      const feature = ROUTE_FEATURES[r];
      expect(feature && ALWAYS_FREE_FEATURES.has(feature)).toBe(true);
      for (const state of [{ kind: 'free' as const }, { kind: 'unknown' as const }]) {
        expect(canUse(feature!, { subscriptionsEnabled: true, state, now: 0 })).toBe(true);
      }
    }
  });

  it('billing is disabled in this build, so nothing is gated', () => {
    expect(featureFlags.subscriptions).toBe(false);
    for (const f of Object.values(ROUTE_FEATURES)) expect(canUse(f, { subscriptionsEnabled: featureFlags.subscriptions, state: { kind: 'free' }, now: 0 })).toBe(true);
  });
});
