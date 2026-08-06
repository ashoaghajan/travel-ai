import { useMemo, useSyncExternalStore } from 'react';
import type { Booking, BookingDraft, BookingPatch, BookingStatus } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS } from '../services/localStorage.service';
import { bookingService, readBookingsSync } from '../services/booking.service';
import { migrateLegacyTripBookings } from '../services/booking.migration';
import { createStorageSnapshot } from './createStorageSnapshot';

/**
 * Shared read model for bookings.
 *
 * Components read through `useBookings()` / `useTripBookings()` and write
 * through `bookingStore`. Writes land immediately — a booking is a real-world
 * fact, not a draft edit, so it deliberately sits outside the trip page's
 * Save Changes session.
 */

// Before the snapshot's first read, so a trip still carrying the old embedded
// array is already migrated by the time anything paints.
migrateLegacyTripBookings();

const bookings = createStorageSnapshot(STORAGE_KEYS.bookings, readBookingsSync);

export const bookingStore = {
  subscribe: bookings.subscribe,
  getSnapshot: bookings.getSnapshot,

  async create(draft: BookingDraft): Promise<Booking> {
    return bookingService.create(draft);
  },

  /** Files a planned trip's whole schedule at once — see the service. */
  async createFromItinerary(trip: Trip): Promise<Booking[]> {
    return bookingService.createFromItinerary(trip);
  },

  async update(id: string, patch: BookingPatch): Promise<Booking> {
    return bookingService.update(id, patch);
  },

  async remove(id: string): Promise<void> {
    return bookingService.remove(id);
  },

  async attach(id: string, tripId: string | null): Promise<Booking> {
    return bookingService.attach(id, tripId);
  },

  async setStatus(id: string, status: BookingStatus): Promise<Booking> {
    return bookingService.setStatus(id, status);
  },
};

/** Every booking, newest first. */
export function useBookings(): Booking[] {
  return useSyncExternalStore(bookings.subscribe, bookings.getSnapshot, bookings.getSnapshot);
}

/**
 * One trip's bookings.
 *
 * Derived with `useMemo` over the whole snapshot rather than by filtering
 * inside a getter of its own: `useSyncExternalStore` requires a stable
 * reference between changes, and a freshly-filtered array per call would
 * render forever.
 */
export function useTripBookings(tripId: string): Booking[] {
  const all = useBookings();
  return useMemo(() => all.filter((booking) => booking.tripId === tripId), [all, tripId]);
}

/**
 * Every trip's bookings, grouped once.
 *
 * For a page rendering a list of trip cards: one subscription and one pass,
 * rather than each card calling `useTripBookings` and filtering the whole
 * snapshot for itself. Memoised for the same reason that one is — a fresh Map
 * per call would never compare equal.
 */
export function useBookingsByTrip(): Map<string, Booking[]> {
  const all = useBookings();

  return useMemo(() => {
    const byTrip = new Map<string, Booking[]>();

    for (const booking of all) {
      if (!booking.tripId) continue;

      const group = byTrip.get(booking.tripId);
      if (group) group.push(booking);
      else byTrip.set(booking.tripId, [booking]);
    }

    return byTrip;
  }, [all]);
}

/**
 * Bookings filed against no trip, or against one that no longer exists.
 *
 * Deleting a trip does not cascade — `tripService.deleteTrip` stays ignorant
 * of bookings rather than inverting the dependency — so an orphan is resolved
 * here, at read time, where it costs nothing.
 */
export function useUnassignedBookings(tripIds: string[]): Booking[] {
  const all = useBookings();
  // Keyed on the ids themselves, not the array: callers build that list with
  // `trips.map(...)`, which is a new array on every render.
  const key = tripIds.join(',');

  return useMemo(() => {
    const live = new Set(key ? key.split(',') : []);
    return all.filter((booking) => !booking.tripId || !live.has(booking.tripId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, key]);
}
