import { currentTzOffsetMin } from '@threshold/core';

export interface Clock {
  now(): number;
  tzOffsetMin(at?: number): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  tzOffsetMin: (at?: number) => currentTzOffsetMin(at === undefined ? new Date() : new Date(at)),
};

/** Controllable clock for tests. */
export function fixedClock(start: number, tz = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    tzOffsetMin: () => tz,
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
}
