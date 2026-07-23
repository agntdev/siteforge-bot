// Per-user rate limiting for project generation. Counts successful generations
// in a sliding window and blocks (with a friendly retry time) when the limit is
// exceeded. State is durable (store.ts) and time goes through the clock seam so
// a test can drive the window deterministically.

import { storeGet, storeSet } from "./store.js";
import { now } from "./clock.js";

const HOUR_MS = 60 * 60 * 1000;

export interface RateLimitState {
  /** Epoch-ms of each generation in the current window (oldest first). */
  timestamps: number[];
}

export interface RateLimitResult {
  ok: boolean;
  /** When ok=false: epoch-ms the user may retry at. */
  retryAt?: number;
  /** Count used in the current window (after this attempt would be counted). */
  remaining: number;
}

export interface RateLimitConfig {
  /** Max generations per window per user. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { limit: 5, windowMs: HOUR_MS };

function rlKey(userId: number | string): string {
  return `rl:${userId}`;
}

/** Check whether `userId` may generate now. Does NOT consume — call
 *  `recordGeneration` after a successful generation. */
export async function checkRateLimit(
  userId: number | string,
  cfg: RateLimitConfig = DEFAULT_RATE_LIMIT,
): Promise<RateLimitResult> {
  const state = (await storeGet<RateLimitState>(rlKey(userId))) ?? { timestamps: [] };
  const t = now();
  const cutoff = t - cfg.windowMs;
  const active = state.timestamps.filter((ts) => ts > cutoff);
  if (active.length >= cfg.limit) {
    const retryAt = active[0] + cfg.windowMs;
    return { ok: false, retryAt, remaining: 0 };
  }
  return { ok: true, remaining: cfg.limit - active.length };
}

/** Record a successful generation against the user's window. */
export async function recordGeneration(
  userId: number | string,
  cfg: RateLimitConfig = DEFAULT_RATE_LIMIT,
): Promise<void> {
  const state = (await storeGet<RateLimitState>(rlKey(userId))) ?? { timestamps: [] };
  const t = now();
  const cutoff = t - cfg.windowMs;
  state.timestamps = state.timestamps.filter((ts) => ts > cutoff);
  state.timestamps.push(t);
  await storeSet(rlKey(userId), state);
}

/** Test/admin hook: clear a user's rate-limit window. */
export async function resetRateLimit(userId: number | string): Promise<void> {
  await storeSet(rlKey(userId), { timestamps: [] });
}
