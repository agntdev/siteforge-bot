// Durable domain-data store.
//
// The toolkit's persistent storage is grammY's StorageAdapter interface, which
// `createBot` auto-selects for SESSION state (Redis when REDIS_URL is set in
// production, in-memory otherwise). We reuse that same adapter machinery for
// DURABLE DOMAIN data (project requests, user profiles, settings, rate-limit
// counters) — never a hand-rolled in-memory Map, and never a keyspace scan
// (KEYS/SCAN/readAllKeys). Collections are read through explicit index records
// (e.g. a list of ids), not by enumerating keys.
//
// In production (REDIS_URL set) data survives restarts in Redis. In the test
// harness / dev (no REDIS_URL) it is in-memory and per-process — sufficient
// because each spec uses a distinct userId so no spec leaks state into another.

import type { StorageAdapter } from "grammy";
import { resolveSessionStorage } from "./toolkit/session/redis.js";

// One shared adapter for all domain data. Auto-selects Redis (prod) or memory
// (dev/harness) exactly like session storage does.
const adapter: StorageAdapter<Record<string, unknown>> = resolveSessionStorage<Record<string, unknown>>(undefined);

const PREFIX = "domain:";

function k(key: string): string {
  return PREFIX + key;
}

/** Read a JSON value, or undefined if absent/corrupt. Returns a deep copy so
 *  callers can mutate freely without aliasing the stored object. */
export async function storeGet<T>(key: string): Promise<T | undefined> {
  const raw = (await adapter.read(k(key))) as unknown;
  if (raw === undefined || raw === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(raw)) as T;
  } catch {
    return undefined;
  }
}

/** Write a JSON-serializable value. */
export async function storeSet<T>(key: string, value: T): Promise<void> {
  await adapter.write(k(key), value as unknown as Record<string, unknown>);
}

/** Delete a value. */
export async function storeDel(key: string): Promise<void> {
  await adapter.delete(k(key));
}
