import { requireOptionalNativeModule } from 'expo-modules-core';

interface ThresholdVisionNativeModule {
  recognizeText(uri: string): Promise<{ text: string; confidence: number }[]>;
}

/** Null when the native module is not linked (Expo Go, tests, simulators without the build). */
export const ThresholdVisionNative = requireOptionalNativeModule<ThresholdVisionNativeModule>('ThresholdVision');
