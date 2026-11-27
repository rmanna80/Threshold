import { env } from './env';

/**
 * Feature flags isolate experimental capabilities. Flags that gate *claims* (gesture detection,
 * recovery prediction) must stay `false` in production until the corresponding model has a
 * validation report with status "validated" in the model registry (see MODEL_VALIDATION.md).
 */
export interface FeatureFlags {
  /** Gesture-assisted logging prompts. Requires a validated on-device gesture model. */
  gestureAssistedLogging: boolean;
  /** Internal research recording UI (labelled motion capture). */
  gestureResearchMode: boolean;
  /** Personalized next-day recovery predictions. Requires a validated model. */
  recoveryPrediction: boolean;
  /** Optional cloud synchronization (requires EXPO_PUBLIC_API_URL). */
  cloudSync: boolean;
  /** StoreKit subscriptions. Billing stays disabled until tested end-to-end. */
  subscriptions: boolean;
  /** Camera label scanning via Apple Vision (native module required at runtime). */
  labelScanning: boolean;
  /** Prompt to start a session after repeated drinking-like gestures (watch foreground only). */
  automaticDetectionPrompt: boolean;
}

export const featureFlags: Readonly<FeatureFlags> = Object.freeze({
  gestureAssistedLogging: false,
  gestureResearchMode: env.researchBuild,
  recoveryPrediction: false,
  cloudSync: env.apiUrl.length > 0,
  subscriptions: false,
  labelScanning: true,
  automaticDetectionPrompt: false,
});
