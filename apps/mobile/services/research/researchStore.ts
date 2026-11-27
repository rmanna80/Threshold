import { ThresholdWatchNative } from '../../modules/threshold-watch';

export interface ResearchRecordingInfo {
  id: string;
  uri: string;
  bytes: number;
  label: string | null;
  participantId: string | null;
  protocolId: string | null;
  startedAt: number | null;
}

/** On-device storage for labelled research recordings received from the watch. */
export interface ResearchFileStore {
  readonly available: boolean;
  setAccepting(on: boolean): Promise<void>;
  list(): Promise<ResearchRecordingInfo[]>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
  onFile(listener: (info: { id: string; accepted: boolean }) => void): () => void;
}

export function createNativeResearchStore(): ResearchFileStore {
  const native = ThresholdWatchNative;
  if (!native) {
    return {
      available: false,
      setAccepting: async () => undefined,
      list: async () => [],
      remove: async () => undefined,
      removeAll: async () => undefined,
      onFile: () => () => undefined,
    };
  }
  return {
    available: true,
    setAccepting: (on) => native.setResearchAccepting(on),
    list: async () =>
      (await native.listResearchRecordings()).map((r) => ({
        id: r.id,
        uri: r.uri,
        bytes: r.bytes,
        label: r.label ?? null,
        participantId: r.participantId ?? null,
        protocolId: r.protocolId ?? null,
        startedAt: r.startedAt ?? null,
      })),
    remove: (id) => native.deleteResearchRecording(id),
    removeAll: () => native.deleteAllResearchRecordings(),
    onFile: (l) => {
      const sub = native.addListener('onResearchFile', l);
      return () => sub.remove();
    },
  };
}

/** In-memory store for tests. */
export class MemoryResearchStore implements ResearchFileStore {
  available = true;
  accepting = false;
  files: ResearchRecordingInfo[] = [];
  private listeners = new Set<(info: { id: string; accepted: boolean }) => void>();

  async setAccepting(on: boolean) {
    this.accepting = on;
  }
  async list() {
    return [...this.files];
  }
  async remove(id: string) {
    this.files = this.files.filter((f) => f.id !== id);
  }
  async removeAll() {
    this.files = [];
  }
  onFile(l: (info: { id: string; accepted: boolean }) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  /** Simulates the native layer receiving a file from the watch. */
  receive(file: ResearchRecordingInfo) {
    const accepted = this.accepting;
    if (accepted) this.files.push(file);
    for (const l of this.listeners) l({ id: file.id, accepted });
  }
}
