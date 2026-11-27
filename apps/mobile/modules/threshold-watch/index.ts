import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export interface NativeWatchState {
  supported: boolean;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
  activated: boolean;
  pendingTransfers?: number;
}

export interface NativeResearchRecording {
  id: string;
  uri: string;
  bytes: number;
  label?: string;
  participantId?: string;
  protocolId?: string;
  startedAt?: number;
}

interface ThresholdWatchNativeModule {
  getState(): Promise<NativeWatchState>;
  updateApplicationContext(context: Record<string, unknown>): Promise<void>;
  transferUserInfo(payload: Record<string, unknown>): Promise<void>;
  drainInbox(): Promise<Record<string, unknown>[]>;
  acknowledge(ids: string[]): Promise<void>;
  setResearchAccepting(on: boolean): Promise<void>;
  listResearchRecordings(): Promise<NativeResearchRecording[]>;
  deleteResearchRecording(id: string): Promise<void>;
  deleteAllResearchRecordings(): Promise<void>;
  addListener(event: 'onWatchMessage', listener: (payload: Record<string, unknown>) => void): EventSubscription;
  addListener(event: 'onWatchStateChange', listener: (state: NativeWatchState) => void): EventSubscription;
  addListener(event: 'onResearchFile', listener: (info: { id: string; accepted: boolean }) => void): EventSubscription;
}

/** Null when the native module is not linked (Expo Go, tests, non-iOS). */
export const ThresholdWatchNative = requireOptionalNativeModule<ThresholdWatchNativeModule>('ThresholdWatch');
