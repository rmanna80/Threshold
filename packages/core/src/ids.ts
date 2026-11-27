/**
 * UUID v4 generation with an injectable source so engines stay deterministic in tests and can
 * use platform CSPRNGs (expo-crypto on device, Node crypto in tests).
 */
export type IdGenerator = () => string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function defaultGenerator(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  throw new Error('No CSPRNG-backed UUID generator configured. Call setIdGenerator() at startup.');
}

let generator: IdGenerator = defaultGenerator;

export function setIdGenerator(next: IdGenerator): void {
  generator = next;
}

export function newId(): string {
  const id = generator();
  if (!isUuid(id)) throw new Error(`ID generator returned a non-UUID value: ${id}`);
  return id.toLowerCase();
}

/** Deterministic generator for tests: produces valid v4-shaped UUIDs from a counter. */
export function sequentialIdGenerator(prefix = 0): IdGenerator {
  let n = prefix;
  return () => {
    n += 1;
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}
