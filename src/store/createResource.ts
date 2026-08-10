/**
 * A shared read model backed by the API.
 *
 * Replaces `createStorageSnapshot` for anything the server now owns. The shape
 * components read is deliberately the same, which is why swapping the source
 * underneath `useTrips()` did not move most call sites.
 *
 * `useSyncExternalStore` is kept rather than replaced with a context provider
 * or a query library: a provider forces a tree and re-renders on every field
 * change, and a query library is a second paradigm plus a bundle, for what is
 * a handful of shared lists.
 */

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ResourceSnapshot<T> = {
  status: ResourceStatus;
  data: T;
  error: Error | null;
};

function asError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

export type Resource<T> = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ResourceSnapshot<T>;
  /** Write-through after a mutation the server has already accepted. */
  set(data: T): void;
  /** Refetch regardless of what is held. */
  refresh(): Promise<void>;
  /** Back to empty and unloaded — sign-out, or a test between cases. */
  reset(): void;
};

export function createResource<T>(options: { empty: T; load: () => Promise<T> }): Resource<T> {
  /*
   * One cached object per change, never rebuilt per read.
   *
   * `useSyncExternalStore` compares snapshots with `Object.is` and re-reads on
   * every render — returning a freshly built object each time is an infinite
   * render loop, and a quiet one.
   */
  let snapshot: ResourceSnapshot<T> = { status: 'idle', data: options.empty, error: null };

  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;

  function emit(next: ResourceSnapshot<T>): void {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function load(force = false): Promise<void> {
    // StrictMode mounts effects twice and a busy screen subscribes from many
    // components; all of them want the same list.
    if (inFlight && !force) return inFlight;

    /*
     * The `data` reference survives into the loading state on purpose.
     *
     * A background refresh would otherwise hand every list consumer a new
     * array identity and re-render the screen for a result that has not
     * arrived yet — and, worse, blank it if `empty` were used here instead.
     */
    emit({ ...snapshot, status: 'loading' });

    inFlight = options
      .load()
      .then((data) => emit({ status: 'ready', data, error: null }))
      .catch((caught: unknown) => {
        // Keeps whatever was already shown. A failed refresh must not empty a
        // list the reader is looking at.
        emit({ status: 'error', data: snapshot.data, error: asError(caught) });
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    /**
     * The first subscriber starts the fetch.
     *
     * This is what lets existing call sites keep working untouched: no
     * provider to mount, no bootstrap step, and no `useEffect` in any of the
     * components that read the list.
     */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (snapshot.status === 'idle') void load();

      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): ResourceSnapshot<T> {
      return snapshot;
    },

    /**
     * Replace the data with what the server just returned.
     *
     * Always the server's own response, never a locally merged guess — the
     * server owns `updatedAt`, `version` and any field it normalises, and a
     * client-side merge would show a trip that does not match the row.
     */
    set(data: T): void {
      emit({ status: 'ready', data, error: null });
    },

    refresh(): Promise<void> {
      return load(true);
    },

    reset(): void {
      inFlight = null;
      emit({ status: 'idle', data: options.empty, error: null });
    },
  };
}
