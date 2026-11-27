import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export interface NativeWatchState {
  supported: boolean;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
  activated: boolean;
  pendingTransfers?: number;
}

interface ThresholdWatchNativeModule {
  getState(): Promise<NativeWatchState>;
  updateApplicationContext(context: Record<string, unknown>): Promise<void>;
  transferUserInfo(payload: Record<string, unknown>): Promise<void>;
  drainInbox(): Promise<Record<string, unknown>[]>;
  acknowledge(ids: string[]): Promise<void>;
  addListener(event: 'onWatchMessage', listener: (payload: Record<string, unknown>) => void): EventSubscription;
  addListener(event: 'onWatchStateChange', listener: (state: NativeWatchState) => void): EventSubscription;
}

/** Null when the native module is not linked (Expo Go, tests, non-iOS). */
export const ThresholdWatchNative = requireOptionalNativeModule<ThresholdWatchNativeModule>('ThresholdWatch');
