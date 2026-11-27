import type { EpochMs, LocalDateKey, TzOffsetMin } from '@threshold/shared-types';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Current offset in minutes east of UTC (inverse sign of Date#getTimezoneOffset). */
export function currentTzOffsetMin(date: Date = new Date()): TzOffsetMin {
  const offset = -date.getTimezoneOffset();
  return offset === 0 ? 0 : offset; // normalise -0
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Local calendar date for an instant, using the offset captured with the event.
 * `dayBoundaryHour` shifts the start of the day (e.g. 5 → events before 05:00 count toward
 * the previous evening).
 */
export function localDateKey(at: EpochMs, tzOffsetMin: TzOffsetMin, dayBoundaryHour = 0): LocalDateKey {
  if (!Number.isFinite(at)) throw new RangeError('Invalid timestamp');
  if (!Number.isInteger(dayBoundaryHour) || dayBoundaryHour < 0 || dayBoundaryHour > 23) {
    throw new RangeError('dayBoundaryHour must be an integer in [0, 23]');
  }
  const shifted = new Date(at + tzOffsetMin * MINUTE_MS - dayBoundaryHour * HOUR_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function parseDateKey(key: LocalDateKey): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`Invalid date key: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addDays(key: LocalDateKey, days: number): LocalDateKey {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 0 = Monday … 6 = Sunday (ISO weekday - 1). */
export function weekdayIndex(key: LocalDateKey): number {
  const { year, month, day } = parseDateKey(key);
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

/** Monday that starts the ISO week containing `key`. */
export function startOfWeek(key: LocalDateKey): LocalDateKey {
  return addDays(key, -weekdayIndex(key));
}

export function startOfMonth(key: LocalDateKey): LocalDateKey {
  const { year, month } = parseDateKey(key);
  return `${year}-${pad(month)}-01`;
}

export function daysBetween(a: LocalDateKey, b: LocalDateKey): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS,
  );
}

export function enumerateDays(from: LocalDateKey, to: LocalDateKey): LocalDateKey[] {
  const n = daysBetween(from, to);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** Human-readable duration, e.g. "1 h 05 min" or "12 min". Never used as a countdown. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${pad(minutes)} min`;
}

/** Relative freshness label for a measurement timestamp. */
export function formatAge(measuredAt: EpochMs, now: EpochMs): string {
  const diff = Math.max(0, now - measuredAt);
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} min ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} h ago`;
  return `${Math.floor(diff / DAY_MS)} d ago`;
}

/**
 * When to suggest the morning check-in after a session: the first `hour`:00 local time that is
 * at least `minGapHours` after the session ended.
 */
export function nextCheckinReminderAt(endedAt: EpochMs, tzOffsetMin: TzOffsetMin, hour = 9, minGapHours = 4): EpochMs {
  const earliest = endedAt + minGapHours * HOUR_MS;
  const local = new Date(earliest + tzOffsetMin * MINUTE_MS);
  let candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - tzOffsetMin * MINUTE_MS;
  if (candidate < earliest) candidate += DAY_MS;
  return candidate;
}
