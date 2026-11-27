/**
 * Crash reporting interface with mandatory scrubbing.
 *
 * No crash-reporting SDK is integrated in this build (`unconfiguredTransport`), so nothing is
 * ever sent. If one is added, it must be wrapped as a `CrashTransport` and every event passes
 * through `scrubEvent` first, and only when the user has opted in (consent `crash_reporting`).
 * Drink, alcohol, health, check-in and study data must never appear in diagnostics.
 */

export interface CrashEvent {
  name: string;
  message: string;
  stack: string | null;
  tags: Record<string, string>;
  breadcrumbs: { category: string; message: string }[];
  isFatal: boolean;
}

export interface CrashTransport {
  readonly configured: boolean;
  send(event: CrashEvent): Promise<void>;
}

export const unconfiguredTransport: CrashTransport = { configured: false, send: async () => undefined };

/** Keys whose values are dropped entirely. */
export const SENSITIVE_KEY =
  /(drink|alcohol|ethanol|abv|standard|bac|beverage|session|heart|hrv|sleep|health|measurement|baseline|symptom|severity|checkin|check_in|nausea|headache|recovery|participant|study|research|email|password|token|secret|auth|cookie|note|name|location|latitude|longitude|weight|height|age)/i;
const ALLOWED_TAGS = new Set(['appVersion', 'buildNumber', 'osVersion', 'platform', 'screen', 'release']);

/** Redact identifiers and numbers from free text (error messages, breadcrumbs). */
export function scrubText(s: string): string {
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [token]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\d+([.,]\d+)?/g, '#')
    .slice(0, 500);
}

/**
 * Stack frames keep function and file names only (no absolute paths, no query strings); any
 * non-frame line (the error message repeated at the top of a stack) is scrubbed like a message.
 */
export function scrubStack(stack: string | undefined | null): string | null {
  if (!stack) return null;
  const stripPaths = (line: string) => line.replace(/(?:(?:file|https?):\/\/[^/\s()]*)?(?:\/[^\s/():]+)+\/([^/\s():?]+)(\?[^\s)]*)?/g, '$1');
  return stack
    .split('\n')
    .slice(0, 50)
    .map((line) => (/^\s*at\s/.test(line) ? stripPaths(line) : scrubText(line)))
    .join('\n');
}

export function scrubEvent(e: CrashEvent): CrashEvent {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.tags)) if (ALLOWED_TAGS.has(k) && !SENSITIVE_KEY.test(k)) tags[k] = v.slice(0, 64); // allow-listed, non-user values only
  return {
    name: SENSITIVE_KEY.test(e.name) ? 'Error' : e.name.slice(0, 100),
    message: scrubText(e.message),
    stack: scrubStack(e.stack),
    tags,
    // Only the category of a breadcrumb survives; messages can contain user content.
    breadcrumbs: e.breadcrumbs.slice(-20).map((b) => ({ category: SENSITIVE_KEY.test(b.category) ? 'app' : b.category.slice(0, 40), message: '' })),
    isFatal: e.isFatal,
  };
}

export function toCrashEvent(error: unknown, isFatal: boolean, tags: Record<string, string> = {}): CrashEvent {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown');
  return { name: err.name, message: err.message, stack: err.stack ?? null, tags, breadcrumbs: [], isFatal };
}

export class CrashReporter {
  constructor(
    private readonly transport: CrashTransport,
    private readonly optedIn: () => boolean,
    private readonly baseTags: Record<string, string> = {},
  ) {}

  get configured(): boolean {
    return this.transport.configured;
  }

  async capture(error: unknown, isFatal = false): Promise<boolean> {
    if (!this.transport.configured || !this.optedIn()) return false;
    try {
      await this.transport.send(scrubEvent(toCrashEvent(error, isFatal, this.baseTags)));
      return true;
    } catch {
      return false; // reporting must never crash the app
    }
  }
}

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

/** Chain a reporter in front of React Native's global handler (keeps the default red box / crash). */
export function installGlobalHandler(reporter: CrashReporter): void {
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!utils || !reporter.configured) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    void reporter.capture(error, Boolean(isFatal));
    previous(error, isFatal);
  });
}
