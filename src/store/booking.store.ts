import { useMemo, useSyncExternalStore } from 'react';
import type { Booking, BookingDraft, BookingPatch, BookingStatus } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { bookingService } from '../services/booking.service';
import { migrateLegacyTripBookings } from '../services/booking.migration';
import { createResource } from './createResource';
import type { ResourceSnapshot } from './createResource';
import { broadcast, onBroadcast } from './broadcast';
import { offlineSnapshotService } from '../services/offlineSnapshot.service';
import { ApiError } from '../services/http';
import { STORAGE_KEYS, storageService } from '../services/localStorage.service';
import { productAnalyticsService } from '../services/productAnalytics.service';

/**
 * Shared read model for bookings.
 *
 * Components read through `useBookings()` and write through `bookingStore`.
 * Writes land immediately — a booking is a real-world fact, not a draft edit,
 * so it deliberately sits outside the trip page's Save Changes session.
 *
 * Every write goes to the server first and then writes the server's own
 * response into the resource, so a screen never shows a row that does not
 * exist.
 */

// Before the resource's first load, so a trip still carrying the old embedded
// array has been migrated into local bookings by the time the import runs.
migrateLegacyTripBookings();

/** Module-level so the identity is stable — see `createResource`. */
const EMPTY_BOOKINGS: Booking[] = [];

let offlineSnapshotAt: string | null = null;
const offlineListeners = new Set<() => void>();

function setOfflineSnapshotAt(value: string | null): void {
  if (offlineSnapshotAt === value) return;
  offlineSnapshotAt = value;
  offlineListeners.forEach((listener) => listener());
}

function cacheBookings(all: Booking[]): void {
  try {
    offlineSnapshotService.writeBookings(all);
  } catch {
    // A full or blocked cache cannot turn a successful online write into failure.
  }
}

async function loadBookings(): Promise<Booking[]> {
  try {
    const all = await bookingService.getBookings();
    cacheBookings(all);
    setOfflineSnapshotAt(null);
    return all;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 0) throw error;
    const cached = offlineSnapshotService.readBookings();
    if (!cached) throw error;
    setOfflineSnapshotAt(cached.savedAt);
    return cached.data;
  }
}

const bookings = createResource<Booking[]>({
  empty: EMPTY_BOOKINGS,
  load: loadBookings,
});

// Account switch: invalidate offline mode before the new owner's first load.
storageService.subscribe(STORAGE_KEYS.ownerUserId, () => setOfflineSnapshotAt(null));

onBroadcast('bookings', () => {
  void bookings.refresh();
});

const select = (): Booking[] => bookings.getSnapshot().data;

function replaceById(all: Booking[], booking: Booking): Booking[] {
  return all.map((candidate) => (candidate.id === booking.id ? booking : candidate));
}

function storeBookings(all: Booking[]): void {
  bookings.set(all);
  cacheBookings(all);
}

export const bookingStore = {
  subscribe: bookings.subscribe,
  getSnapshot: bookings.getSnapshot,

  async create(draft: BookingDraft): Promise<Booking> {
    const booking = await bookingService.create(draft);

    storeBookings([booking, ...select()]);
    productAnalyticsService.recordBookingSaved(booking.id);
    broadcast('bookings');

    return booking;
  },

  /** Files a planned trip's whole schedule at once — see the service. */
  async createFromItinerary(trip: Trip): Promise<Booking[]> {
    const created = await bookingService.createFromItinerary(trip);
    if (created.length === 0) return created;

    // Schedule order in front of the existing list, matching what the batch
    // endpoint wrote — day one's morning before its afternoon.
    storeBookings([...created, ...select()]);
    broadcast('bookings');

    return created;
  },

  async update(id: string, patch: BookingPatch): Promise<Booking> {
    const booking = await bookingService.update(id, patch);

    storeBookings(replaceById(select(), booking));
    broadcast('bookings');

    return booking;
  },

  async remove(id: string): Promise<void> {
    await bookingService.remove(id);

    storeBookings(select().filter((booking) => booking.id !== id));
    broadcast('bookings');
  },

  async attach(id: string, tripId: string | null): Promise<Booking> {
    return bookingStore.update(id, { tripId });
  },

  async setStatus(id: string, status: BookingStatus): Promise<Booking> {
    return bookingStore.update(id, { status });
  },

  /** Refetch — after a sign-in, or after the local-data import. */
  async refresh(): Promise<void> {
    await bookings.refresh();
  },

  /** Sign-out: the next reader must not see this account's bookings. */
  reset(): void {
    bookings.reset();
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

/**
 * The list plus whether it has arrived, for screens that must tell "none yet"
 * apart from "not loaded yet".
 */
export function useBookingsResource(): ResourceSnapshot<Booking[]> {
  return useSyncExternalStore(bookings.subscribe, bookings.getSnapshot, bookings.getSnapshot);
}

/** Timestamp of the cached booking list currently shown, or null when online. */
export function useBookingOfflineSnapshotAt(): string | null {
  return useSyncExternalStore(
    bookingStore.subscribeOffline,
    bookingStore.getOfflineSnapshotAt,
    bookingStore.getOfflineSnapshotAt,
  );
}

/** Every booking, newest first. */
export function useBookings(): Booking[] {
  return useSyncExternalStore(bookings.subscribe, select, select);
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
