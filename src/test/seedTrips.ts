import { vi } from 'vitest';
import type { Trip } from '../types/trip.types';
import { tripService } from '../services/trip.service';
import { tripStore } from '../store/trip.store';

/**
 * Puts trips in front of a component under test.
 *
 * Screens used to be given trips by writing them to `localStorage`, because
 * that is where the store read them from. Trips live in Postgres now, so the
 * seam moved: the service is stubbed and the store is made to re-read through
 * it.
 *
 * `await` matters. The store fetches, so a component rendered before this
 * resolves sees an empty list — which is the real behaviour, not a test
 * artefact, and the reason `useTripsResource` exposes a loading state at all.
 */
export async function seedTrips(trips: Trip[], activeTripId: string | null = null): Promise<void> {
  vi.spyOn(tripService, 'getTrips').mockResolvedValue(trips);
  vi.spyOn(tripService, 'getActiveTripId').mockResolvedValue(activeTripId);

  // Reset first: the store caches its first load, so a second call in the same
  // file would otherwise keep serving whatever the first one seeded.
  tripStore.reset();
  await tripStore.refresh();
}
