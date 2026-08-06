import { STORAGE_KEYS, storageService } from '../services/localStorage.service';

/**
 * Wires one storage key to a cached snapshot plus React subscriptions.
 *
 * Extracted from `trip.store.ts` when the booking store needed the same thing.
 * Every store built on it refreshes from the storage subscription, so a change
 * made anywhere — another component, another tab — reaches every subscriber.
 *
 * Stage 2 replaces this with `createResource` over the API; the shape of what
 * components read is meant to survive that.
 */
export function createStorageSnapshot<T>(
  key: (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS],
  read: () => T,
) {
  let cache: T = read();
  const listeners = new Set<() => void>();

  storageService.subscribe(key, () => {
    cache = read();
    listeners.forEach((listener) => listener());
  });

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Stable reference between changes — required by `useSyncExternalStore`.
     *
     * Anything deriving a narrower list from this (one trip's bookings, say)
     * must `useMemo` over the snapshot rather than filtering inside its own
     * getter: a fresh array per call is an infinite render loop.
     */
    getSnapshot(): T {
      return cache;
    },
  };
}
