import { ThresholdWatchNative, type NativeWatchState } from '../../modules/threshold-watch';

export type WatchState = NativeWatchState;

/** Transport abstraction so watch sync logic is testable without WatchConnectivity. */
export interface WatchTransport {
  readonly available: boolean;
  getState(): Promise<WatchState>;
  updateContext(context: Record<string, unknown>): Promise<void>;
  drainInbox(): Promise<Record<string, unknown>[]>;
  acknowledge(ids: string[]): Promise<void>;
  onMessage(listener: () => void): () => void;
  onStateChange(listener: (s: WatchState) => void): () => void;
}

const UNSUPPORTED: WatchState = { supported: false, paired: false, installed: false, reachable: false, activated: false };

export function createNativeWatchTransport(): WatchTransport {
  const native = ThresholdWatchNative;
  if (!native) {
    return {
      available: false,
      getState: async () => UNSUPPORTED,
      updateContext: async () => undefined,
      drainInbox: async () => [],
      acknowledge: async () => undefined,
      onMessage: () => () => undefined,
      onStateChange: () => () => undefined,
    };
  }
  return {
    available: true,
    getState: () => native.getState(),
    updateContext: (c) => native.updateApplicationContext(c),
    drainInbox: () => native.drainInbox(),
    acknowledge: (ids) => native.acknowledge(ids),
    onMessage: (l) => {
      const sub = native.addListener('onWatchMessage', () => l());
      return () => sub.remove();
    },
    onStateChange: (l) => {
      const sub = native.addListener('onWatchStateChange', l);
      return () => sub.remove();
    },
  };
}

/** In-memory transport for tests. */
export class MemoryWatchTransport implements WatchTransport {
  available = true;
  contexts: Record<string, unknown>[] = [];
  inbox: Record<string, unknown>[] = [];
  private listeners = new Set<() => void>();
  state: WatchState = { supported: true, paired: true, installed: true, reachable: true, activated: true };
  async getState() {
    return this.state;
  }
  async updateContext(c: Record<string, unknown>) {
    this.contexts.push(c);
  }
  async drainInbox() {
    return [...this.inbox];
  }
  async acknowledge(ids: string[]) {
    this.inbox = this.inbox.filter((m) => !ids.includes(String(m.id)));
  }
  onMessage(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onStateChange() {
    return () => undefined;
  }
  deliver(message: Record<string, unknown>) {
    this.inbox.push(message);
    for (const l of this.listeners) l();
  }
}
