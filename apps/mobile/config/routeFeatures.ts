import type { Feature } from '@threshold/core';

/**
 * Every screen is classified by the feature it belongs to. tests/entitlements.test.ts walks the
 * app/ directory and fails if a route is unclassified, and asserts that safety routes (emergency
 * information, logging, the active session, check-ins, data export/deletion) map to always-free
 * features — so a future paywall cannot accidentally cover them.
 */
export const ROUTE_FEATURES: Readonly<Record<string, Feature>> = Object.freeze({
  '(onboarding)/_layout': 'privacy_controls',
  '(onboarding)/welcome': 'privacy_controls',
  '(onboarding)/eligibility': 'privacy_controls',
  '(onboarding)/goals': 'goals',
  '(onboarding)/habits': 'goals',
  '(onboarding)/permissions': 'privacy_controls',
  '(onboarding)/privacy': 'privacy_controls',
  '(tabs)/_layout': 'session_tracking',
  '(tabs)/index': 'session_tracking',
  '(tabs)/session': 'session_tracking',
  '(tabs)/insights': 'basic_insights',
  '(tabs)/recovery': 'recovery_checkin',
  '(tabs)/profile': 'privacy_controls',
  _layout: 'session_tracking',
  checkin: 'recovery_checkin',
  'edit-drink/[id]': 'drink_logging',
  emergency: 'emergency_information',
  'log-drink': 'drink_logging',
  'scan-label': 'drink_logging',
  'session/[id]': 'session_tracking',
  'settings/_layout': 'privacy_controls',
  'settings/about': 'privacy_controls',
  'settings/data': 'data_export',
  'settings/goals': 'goals',
  'settings/preferences': 'pace_monitoring',
  'settings/privacy': 'privacy_controls',
  'settings/research': 'privacy_controls',
  'settings/sync': 'cloud_sync',
});

/** Routes that must stay reachable for everyone, always. */
export const SAFETY_ROUTES = ['emergency', 'log-drink', '(tabs)/session', '(tabs)/index', 'checkin', 'settings/data', 'edit-drink/[id]'] as const;
