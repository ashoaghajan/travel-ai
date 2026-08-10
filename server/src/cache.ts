/**
 * A small TTL cache in front of a provider.
 *
 * The reason is quota, not latency: the keys are ours, so every reader
 * refreshing a results page spends our allowance. The data also barely moves
 * — fares drift over minutes, and an attraction's address does not move at all
 * — so a short hold costs the reader nothing real.
 *
 * Lives at the server root rather than inside one module because two of them
 * now need it: the travel searches and the places lookups.
 *
 * In-process and unbounded-by-time but bounded by size — one server, one
 * cache. A second instance would want Redis, which is the same interface.
 */

type Entry<T> = { value: T; expiresAt: number };

/** Long enough to absorb a reload loop, short enough that a fare is current. */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Beyond this, the oldest entries go. Bounds memory on a long-lived process. */
const MAX_ENTRIES = 500;

export function createCache<T>(ttlMs: number = DEFAULT_TTL_MS) {
  const entries = new Map<string, Entry<T>>();

  return {
    get(key: string): T | null {
      const entry = entries.get(key);
      if (!entry) return null;

      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }

      // Re-insert so `entries` stays in least-recently-used order for eviction.
      entries.delete(key);
      entries.set(key, entry);

      return entry.value;
    },

    set(key: string, value: T): void {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });

      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },

    clear(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}
