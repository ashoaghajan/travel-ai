import { useSyncExternalStore } from 'react';
import type { Trip, TripDraft, TripPatch } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import { tripService } from '../services/trip.service';
import { createResource } from './createResource';
import type { ResourceSnapshot } from './createResource';
import { broadcast, onBroadcast } from './broadcast';
import { offlineSnapshotService } from '../services/offlineSnapshot.service';
import { ApiError } from '../services/http';
import { STORAGE_KEYS, storageService } from '../services/localStorage.service';
import { productAnalyticsService } from '../services/productAnalytics.service';

/**
 * Shared read model for saved trips.
 *
 * Components read through `useTrips()` / `useActiveTripId()` and write through
 * `tripStore`. Every write goes to the server first and then writes the
 * server's own response into the resource, so what a screen shows is always a
 * row that exists rather than a locally merged guess.
 *
 * `useTrips()` keeps the signature it had when this read `localStorage`, which
 * is why moving the source underneath it left most call sites untouched.
 */

/** Module-level so the identity is stable — see `createResource`. */
const EMPTY_TRIPS: Trip[] = [];

let offlineSnapshotAt: string | null = null;
const offlineListeners = new Set<() => void>();

function setOfflineSnapshotAt(value: string | null): void {
  if (offlineSnapshotAt === value) return;
  offlineSnapshotAt = value;
  offlineListeners.forEach((listener) => listener());
}

function cacheTrips(trips: Trip[]): void {
  try {
    offlineSnapshotService.writeTrips(trips);
  } catch {
    // Storage failure must not discard the server's successful response.
  }
}

async function loadTrips(): Promise<Trip[]> {
  try {
    const trips = await tripService.getTrips();
    cacheTrips(trips);
    setOfflineSnapshotAt(null);
    return trips;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 0) throw error;
    const cached = offlineSnapshotService.readTrips();
    if (!cached) throw error;
    setOfflineSnapshotAt(cached.savedAt);
    return cached.data;
  }
}

const tripsResource = createResource<Trip[]>({
  empty: EMPTY_TRIPS,
  load: loadTrips,
});

const activeTripResource = createResource<string | null>({
  empty: null,
  load: () => tripService.getActiveTripId(),
});

// The archived snapshot is account-scoped; clear its UI mode when ownership changes.
storageService.subscribe(STORAGE_KEYS.ownerUserId, () => setOfflineSnapshotAt(null));

// Another tab saved, edited or deleted something. Refetch rather than trust a
// payload — the two tabs can be at different versions of the same trip.
onBroadcast('trips', () => {
  void tripsResource.refresh();
  void activeTripResource.refresh();
});

const selectTrips = (): Trip[] => tripsResource.getSnapshot().data;
const selectActiveTripId = (): string | null => activeTripResource.getSnapshot().data;

/**
 * The list with one trip inserted or replaced, newest first.
 *
 * An upsert rather than a prepend because `createTrip` is idempotent by
 * `draftId`: saving the same draft twice returns the trip that already exists,
 * and prepending it would show it twice.
 */
function upsertNewestFirst(trips: Trip[], trip: Trip): Trip[] {
  const without = trips.filter((candidate) => candidate.id !== trip.id);

  return [trip, ...without];
}

function replaceById(trips: Trip[], trip: Trip): Trip[] {
  return trips.map((candidate) => (candidate.id === trip.id ? trip : candidate));
}

function storeTrips(trips: Trip[]): void {
  tripsResource.set(trips);
  cacheTrips(trips);
}

export const tripStore = {
  subscribe: tripsResource.subscribe,
  getSnapshot: tripsResource.getSnapshot,

  /** Idempotent by `draftId` — see `tripService.createTrip`. */
  async saveTrip(draft: TripDraft): Promise<Trip> {
    const trip = await tripService.createTrip(draft);

    storeTrips(upsertNewestFirst(selectTrips(), trip));
    productAnalyticsService.recordTripCreated(trip.id);
    broadcast('trips');

    return trip;
  },

  /**
   * Files a trip this account acquired without saving it.
   *
   * Accepting a shared trip, today: the row is already written — by
   * `POST /api/shares/:id/accept`, which never goes through this store — so
   * what is missing is that every screen reading from here still holds a list
   * from before it existed. That is why the trips page needed a reload to show
   * one.
   *
   * Merged only into a list that is actually a list. `set` marks the resource
   * ready, so writing one trip into a resource that has never loaded would
   * leave the account holding exactly that one trip until a reload — the same
   * bug inverted, and worse. When nothing is held yet the first reader loads
   * the whole list anyway, which will include this trip.
   */
  adoptTrip(trip: Trip): void {
    const { status } = tripsResource.getSnapshot();

    if (status === 'ready') {
      // Upserted rather than prepended because accepting is idempotent:
      // pressing twice returns the same trip, and a prepend would show it
      // twice.
      storeTrips(upsertNewestFirst(selectTrips(), trip));
    } else if (status !== 'idle') {
      // Loading or errored: whatever answer is in flight was asked for before
      // this trip existed, so it cannot be merged into — ask again.
      void tripsResource.refresh();
    }

    // Other tabs refetch rather than being handed a payload, as with every
    // other write here.
    broadcast('trips');
  },

  async updateTrip(id: string, patch: TripPatch): Promise<Trip> {
    const previous = selectTrips().find((candidate) => candidate.id === id);
    const trip = await tripService.updateTrip(id, patch);

    storeTrips(replaceById(selectTrips(), trip));
    if (previous && patch.itinerary) {
      const existing = new Set(previous.itinerary.flatMap((day) => day.activities.map((activity) => activity.id)));
      for (const activity of trip.itinerary.flatMap((day) => day.activities)) {
        if (!existing.has(activity.id)) {
          productAnalyticsService.recordPlaceAdded(id, activity.sourceActivityId ?? activity.id);
        }
      }
    }
    broadcast('trips');

    return trip;
  },

  /** Adds an explorer attraction to one day; see `tripService`. */
  async addActivityToDay(
    tripId: string,
    dayId: string,
    activity: Activity,
    options: { time?: string } = {},
  ): Promise<Trip> {
    const trip = await tripService.addActivityToDay(tripId, dayId, activity, options);

    storeTrips(replaceById(selectTrips(), trip));
    productAnalyticsService.recordPlaceAdded(tripId, activity.id);
    broadcast('trips');

    return trip;
  },

  async deleteTrip(id: string): Promise<void> {
    await tripService.deleteTrip(id);

    storeTrips(selectTrips().filter((trip) => trip.id !== id));

    // Never leave the active pointer aimed at a trip that no longer exists.
    if (selectActiveTripId() === id) activeTripResource.set(null);

    broadcast('trips');
  },

  async setActiveTrip(id: string | null): Promise<void> {
    // Opening a trip runs this on every render pass that resolves one, so a
    // no-op write would be a request per page view.
    if (selectActiveTripId() === id) return;

    await tripService.setActiveTrip(id);
    activeTripResource.set(id);
  },

  /**
   * Adopt the active-trip pointer that came back with the account.
   *
   * `GET /api/me` already carries it, so fetching it again would make boot two
   * requests for one answer. Setting it here also marks the resource ready, so
   * the first subscriber does not trigger a load at all.
   */
  primeActiveTrip(tripId: string | null): void {
    activeTripResource.set(tripId);
  },

  /** Refetch both lists — after a sign-in, or after the local-data import. */
  async refresh(): Promise<void> {
    await Promise.all([tripsResource.refresh(), activeTripResource.refresh()]);
  },

  /**
   * Drop everything held.
   *
   * For sign-out: the next reader must not see the previous account's trips
   * for the moment before their own arrive.
   */
  reset(): void {
    tripsResource.reset();
    activeTripResource.reset();
    setOfflineSnapshotAt(null);
  },

  getOfflineSnapshotAt(): string | null {
    return offlineSnapshotAt;
  },

  subscribeOffline(listener: () => void): () => void {
    offlineListeners.add(listener);
    return () => offlineListeners.delete(listener);
  },
};

/** Saved trips, newest first. */
export function useTrips(): Trip[] {
  return useSyncExternalStore(tripsResource.subscribe, selectTrips, selectTrips);
}

/**
 * The list plus whether it has arrived.
 *
 * For the screens that must tell "no trips yet" apart from "not loaded yet" —
 * an empty-state illustration shown while the list is still in flight reads as
 * "you have nothing", which is a different and wrong claim.
 */
export function useTripsResource(): ResourceSnapshot<Trip[]> {
  return useSyncExternalStore(
    tripsResource.subscribe,
    tripsResource.getSnapshot,
    tripsResource.getSnapshot,
  );
}

/** Timestamp of the cached list currently being shown, or null when online. */
export function useTripOfflineSnapshotAt(): string | null {
  return useSyncExternalStore(
    tripStore.subscribeOffline,
    tripStore.getOfflineSnapshotAt,
    tripStore.getOfflineSnapshotAt,
  );
}

/** Id of the trip last opened, or null. */
export function useActiveTripId(): string | null {
  return useSyncExternalStore(
    activeTripResource.subscribe,
    selectActiveTripId,
    selectActiveTripId,
  );
}
