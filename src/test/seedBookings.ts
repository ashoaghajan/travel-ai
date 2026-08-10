import { vi } from 'vitest';
import type { Booking } from '../types/booking.types';
import { bookingService } from '../services/booking.service';
import { bookingStore } from '../store/booking.store';

/**
 * Puts bookings in front of a component under test.
 *
 * The counterpart to `seedTrips`, and for the same reason: screens used to be
 * given bookings by writing them to `localStorage`, and that is no longer
 * where the store reads them from.
 *
 * `await` matters — the store fetches, so a component rendered before this
 * resolves sees an empty list.
 */
export async function seedBookings(bookings: Booking[]): Promise<void> {
  vi.spyOn(bookingService, 'getBookings').mockResolvedValue(bookings);

  // Reset first: the store caches its first load, so a second call in the same
  // file would otherwise keep serving whatever the first one seeded.
  bookingStore.reset();
  await bookingStore.refresh();
}
