import { useSyncExternalStore } from 'react';
import type { Trip, TripDraft } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import { STORAGE_KEYS } from '../services/localStorage.service';
import { readActiveTripId, readTripsSync, tripService } from '../services/trip.service';
import { createStorageSnapshot } from './createStorageSnapshot';

/**
 * Shared read model for saved trips.
 *
 * Components read through `useTrips()` / `useActiveTripId()` and write through
 * `tripStore`. Both caches refresh from the storage subscription, so a change
 * made anywhere — another component, another tab — reaches every subscriber.
 */

const trips = createStorageSnapshot(STORAGE_KEYS.trips, readTripsSync);
const activeTripId = createStorageSnapshot(STORAGE_KEYS.activeTripId, readActiveTripId);

export const tripStore = {
  subscribe: trips.subscribe,
  getSnapshot: trips.getSnapshot,

  /** Idempotent by `draftId` — see `tripService.createTrip`. */
  async saveTrip(draft: TripDraft): Promise<Trip> {
    return tripService.createTrip(draft);
  },

  async updateTrip(id: string, patch: Partial<TripDraft>): Promise<Trip> {
    return tripService.updateTrip(id, patch);
  },

  /** Adds an explorer attraction to one day; see `tripService`. */
  async addActivityToDay(
    tripId: string,
    dayId: string,
    activity: Activity,
    options: { time?: string } = {},
  ): Promise<Trip> {
    return tripService.addActivityToDay(tripId, dayId, activity, options);
  },

  async deleteTrip(id: string): Promise<void> {
    return tripService.deleteTrip(id);
  },

  async setActiveTrip(id: string | null): Promise<void> {
    return tripService.setActiveTrip(id);
  },
};

/** Saved trips, newest first. */
export function useTrips(): Trip[] {
  return useSyncExternalStore(trips.subscribe, trips.getSnapshot, trips.getSnapshot);
}

/** Id of the trip last opened, or null. */
export function useActiveTripId(): string | null {
  return useSyncExternalStore(
    activeTripId.subscribe,
    activeTripId.getSnapshot,
    activeTripId.getSnapshot,
  );
}
