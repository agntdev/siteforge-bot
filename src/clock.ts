// Injectable clock seam. Route every "now", expiry, and late/on-time decision
// through `now()` so tests can drive time-based behavior (rate-limit windows,
// retention expiry) deterministically — instead of inline `new Date()` /
// `Date.now()` which a test cannot control.
//
// Tests override `now` (e.g. `import { _clock } from "./clock.js";
// _clock.now = () => FAKE_TIME`); production uses the real wall clock.

export interface Clock {
  now(): number; // epoch ms
}

const _clock: Clock = {
  now(): number {
    return Date.now();
  },
};

export function now(): number {
  return _clock.now();
}

/** Test-only hook: override the clock. Restore with `resetClock()`. */
export function setClock(fn: () => number): void {
  _clock.now = fn;
}

export function resetClock(): void {
  _clock.now = () => Date.now();
}

/** Current UTC date as YYYY-MM-DD (for README / metadata), driven by the seam. */
export function todayUtc(): string {
  return new Date(now()).toISOString().slice(0, 10);
}
