import { useSyncExternalStore } from 'react';
import type { Trip, TripDraft, TripPatch } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import { tripService } from '../services/trip.service';
import { createResource } from './createResource';
import type { ResourceSnapshot } from './createResource';
import { broadcast, onBroadcast } from './broadcast';

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

const tripsResource = createResource<Trip[]>({
  empty: EMPTY_TRIPS,
  load: () => tripService.getTrips(),
});

const activeTripResource = createResource<string | null>({
  empty: null,
  load: () => tripService.getActiveTripId(),
});

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

export const tripStore = {
  subscribe: tripsResource.subscribe,
  getSnapshot: tripsResource.getSnapshot,

  /** Idempotent by `draftId` — see `tripService.createTrip`. */
  async saveTrip(draft: TripDraft): Promise<Trip> {
    const trip = await tripService.createTrip(draft);

    tripsResource.set(upsertNewestFirst(selectTrips(), trip));
    broadcast('trips');

    return trip;
  },

  async updateTrip(id: string, patch: TripPatch): Promise<Trip> {
    const trip = await tripService.updateTrip(id, patch);

    tripsResource.set(replaceById(selectTrips(), trip));
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

    tripsResource.set(replaceById(selectTrips(), trip));
    broadcast('trips');

    return trip;
  },

  async deleteTrip(id: string): Promise<void> {
    await tripService.deleteTrip(id);

    tripsResource.set(selectTrips().filter((trip) => trip.id !== id));

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

/** Id of the trip last opened, or null. */
export function useActiveTripId(): string | null {
  return useSyncExternalStore(
    activeTripResource.subscribe,
    selectActiveTripId,
    selectActiveTripId,
  );
}
