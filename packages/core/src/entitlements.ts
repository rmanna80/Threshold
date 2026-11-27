/**
 * Entitlements.
 *
 * Threshold may one day offer an optional paid tier, but safety and core moderation features are
 * free forever and are never gated — not by plan, not by an expired subscription, not by a store
 * outage. Billing is disabled in this build: `subscriptionsEnabled` is false, so every feature is
 * available to everyone and no purchase UI exists.
 */

export type Feature =
  // Safety & core moderation — always free
  | 'session_tracking'
  | 'drink_logging'
  | 'pace_monitoring'
  | 'interventions'
  | 'goals'
  | 'safety_center'
  | 'emergency_information'
  | 'watch_app'
  | 'recovery_checkin'
  | 'basic_insights'
  | 'data_export'
  | 'data_deletion'
  | 'privacy_controls'
  // Candidates for an optional paid tier (only if billing is ever enabled)
  | 'long_range_trends'
  | 'advanced_health_correlations'
  | 'cloud_sync'
  | 'recovery_prediction';

export const ALWAYS_FREE_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'session_tracking',
  'drink_logging',
  'pace_monitoring',
  'interventions',
  'goals',
  'safety_center',
  'emergency_information',
  'watch_app',
  'recovery_checkin',
  'basic_insights',
  'data_export',
  'data_deletion',
  'privacy_controls',
]);

export const PAID_TIER_CANDIDATES: ReadonlySet<Feature> = new Set<Feature>(['long_range_trends', 'advanced_health_correlations', 'cloud_sync', 'recovery_prediction']);

export type EntitlementState =
  | { kind: 'free' }
  | { kind: 'plus'; expiresAt: number | null }
  | { kind: 'unknown' }; // store unreachable — must never remove access to safety features

export interface EntitlementContext {
  subscriptionsEnabled: boolean;
  state: EntitlementState;
  now: number;
}

export function canUse(feature: Feature, ctx: EntitlementContext): boolean {
  if (ALWAYS_FREE_FEATURES.has(feature)) return true;
  if (!ctx.subscriptionsEnabled) return true; // billing disabled: everything is available
  if (ctx.state.kind === 'plus') return ctx.state.expiresAt === null || ctx.state.expiresAt > ctx.now;
  return false;
}
