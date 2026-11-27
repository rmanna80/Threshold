/**
 * Deterministic last-writer-wins conflict resolution shared by the phone, the watch (Swift port)
 * and the backend (Python port): higher revision wins; then later updatedAt; then the
 * lexicographically greater deviceId (an arbitrary but stable tie-breaker).
 */
export interface Versioned {
  revision: number;
  updatedAt: number;
  deviceId: string;
}

export function compareVersions(a: Versioned, b: Versioned): number {
  if (a.revision !== b.revision) return a.revision - b.revision;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

export function resolveConflict<T extends Versioned>(local: T | null, remote: T): { winner: T; source: 'local' | 'remote' | 'equal' } {
  if (!local) return { winner: remote, source: 'remote' };
  const c = compareVersions(local, remote);
  if (c === 0) return { winner: local, source: 'equal' };
  return c > 0 ? { winner: local, source: 'local' } : { winner: remote, source: 'remote' };
}
