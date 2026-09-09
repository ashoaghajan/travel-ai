import type { LatLng } from '../types/trip.types';
import { http } from './http';

/**
 * Metro stations for a city.
 *
 * Behind `GET /api/places/metro`, which is Overpass — OpenStreetMap's own
 * query endpoint — rather than the attractions directory the rest of this app
 * uses. OpenTripMap has no subway category, and the nearest thing it has is
 * indexed on notability: it returns nothing at all within 15 km of the middle
 * of Tbilisi, a city with a 23-station metro. See `server/.../overpass.ts`.
 *
 * Read by one rule, `nearMetroOnly` in the planner, and fetched only when that
 * rule is on. Nothing else in the app needs to know where a station is: they
 * are not places anybody browses, and they are never shown.
 *
 * No React component may import this file — services call it.
 */

/**
 * Stations for one city, held for the life of the tab.
 *
 * In memory rather than in storage, unlike `geocode.service.ts`, and the
 * asymmetry is the usage rather than the data. A geocode is wanted on every
 * visit to every trip page; this is wanted when somebody generates a trip with
 * one particular preference switched on, which is rare enough that a reload
 * losing the answer costs one request. The server holds its own copy for a
 * day, so that request is usually not a query either.
 */
const stations = new Map<string, LatLng[]>();

/** So two trips planned in the same breath make one request, not two. */
const inFlight = new Map<string, Promise<LatLng[]>>();

type MetroResponse = { stations: { lat: number; lng: number }[] };

function keyFor(destination: string): string {
  return destination.trim().toLowerCase();
}

/**
 * Where the metro stops in this city, or an empty list.
 *
 * **Never rejects, and an empty array is the answer to three different
 * questions**: a city with no metro, a city whose metro nobody has mapped, and
 * a request that failed. The caller — `isNearMetro` — treats all three the
 * same way, by not applying the rule, because none of them is evidence that a
 * particular place is far from a station. Distinguishing them here would only
 * produce a distinction that has to be discarded there.
 */
export async function getMetroStations(destination: string): Promise<LatLng[]> {
  const key = keyFor(destination);
  if (key === '') return [];

  const held = stations.get(key);
  if (held) return held;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = http
    .get<MetroResponse>('/places/metro', { query: { name: destination.trim() } })
    .then((body) => {
      const found = (body.stations ?? []).filter(
        (station) => Number.isFinite(station.lat) && Number.isFinite(station.lng),
      );

      stations.set(key, found);

      return found;
    })
    .catch(() => [])
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);

  return request;
}

/** Test seam, and what sign-out would call if this held anything personal. */
export function clearMetroCache(): void {
  stations.clear();
  inFlight.clear();
}
