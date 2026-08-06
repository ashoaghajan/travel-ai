import type { Booking } from '../types/booking.types';
import type { LegacyTripBooking, Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Moves `Trip.bookings` into the booking store, once.
 *
 * Bookings started life as an array on the trip and moved out when it became
 * clear one could exist before its trip was chosen. Little data was ever
 * written that way, but the read path must not lose any of it — so this runs
 * before the booking snapshot's first read and is idempotent by row id.
 */

function readTrips(): Trip[] {
  const stored = storageService.get<Trip[]>(STORAGE_KEYS.trips, []);
  return Array.isArray(stored) ? stored : [];
}

function readBookings(): Booking[] {
  const stored = storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);
  return Array.isArray(stored) ? stored : [];
}

/**
 * A legacy row as a `Booking`.
 *
 * `status: 'booked'` because these were typed in by hand under a heading that
 * said what was booked — that is a claim of a real reservation, not a
 * shortlist entry. The original `id` is kept, which is what makes a re-run
 * idempotent.
 */
function toBooking(legacy: LegacyTripBooking, tripId: string): Booking {
  return {
    id: legacy.id,
    tripId,
    kind: legacy.kind,
    status: 'booked',
    title: legacy.title,
    date: legacy.date,
    reference: legacy.reference,
    price: legacy.price,
    url: legacy.url,
    createdAt: legacy.createdAt,
    updatedAt: legacy.createdAt,
  };
}

export function migrateLegacyTripBookings(): void {
  try {
    const trips = readTrips();
    const carrying = trips.filter((trip) => (trip.bookings?.length ?? 0) > 0);
    if (carrying.length === 0) return;

    const existing = readBookings();
    const known = new Set(existing.map((booking) => booking.id));

    const lifted = carrying.flatMap((trip) =>
      (trip.bookings ?? [])
        .filter((legacy) => !known.has(legacy.id))
        .map((legacy) => toBooking(legacy, trip.id)),
    );

    // Bookings first. If the second write fails, both copies exist and the
    // id check above dedupes on the next run — nothing is lost either way.
    if (lifted.length > 0) storageService.set(STORAGE_KEYS.bookings, [...lifted, ...existing]);

    storageService.set(
      STORAGE_KEYS.trips,
      trips.map((trip) => {
        if (!trip.bookings) return trip;

        // `updatedAt` is deliberately left alone. `useEditTrip` re-baselines
        // its draft whenever that field moves, so bumping it here would
        // silently discard an edit in progress in another tab.
        const { bookings: _dropped, ...rest } = trip;
        return rest;
      }),
    );
  } catch {
    // A full or blocked store leaves the legacy copy exactly where it is,
    // which is the safe end state — the next load tries again.
  }
}
