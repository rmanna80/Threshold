/**
 * Build-time configuration. Only EXPO_PUBLIC_* variables are inlined into the JS bundle, so this
 * file must never reference secrets. See .env.example at the repository root.
 */
export const env = {
  /** Base URL of the optional Threshold sync API, e.g. https://api.example.com. Empty = no cloud. */
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  /** Enables the internal research data-collection screens (consenting participants only). */
  researchBuild: process.env.EXPO_PUBLIC_RESEARCH_BUILD === '1',
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV ?? 'development') as 'development' | 'staging' | 'production',
} as const;
