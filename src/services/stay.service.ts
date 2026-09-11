import type { StayCandidate } from '../types/planner.types';
import { http } from './http';

/**
 * Finding the building somebody is staying in.
 *
 * Behind `GET /api/places/stay`, which is Nominatim — free-text search over
 * OpenStreetMap — rather than the geoname lookup `geocode.service.ts` uses.
 * The difference is the whole reason this file exists: geoname resolves
 * *cities*, so asking it for "Rooms Hotel" returns nothing, and the planner's
 * "within 2 km of your hotel" quietly became "within 2 km of the middle of
 * the city" for every trip that had no booking attached.
 *
 * **A list, not an answer.** Several hotels share a name in one city and many
 * more share one across countries, so the caller shows what came back and the
 * reader points at the right one. That confirmation is the point: a radius
 * drawn around the wrong building removes a city's worth of places from a trip
 * and never explains itself.
 *
 * No React component may import this file — `planner.stay.ts` calls it.
 */

type StayResponse = {
  candidates: { id: string; name: string; address: string; lat: number; lng: number }[];
};

/**
 * Matches for a hotel name or a street address, best first.
 *
 * **Never rejects, and an empty list is a real answer**: the name was not
 * found. The caller's move then is to ask for an address rather than to report
 * a failure, which is also the right move when the lookup itself failed — so
 * the two are not distinguished here, exactly as they are not in
 * `metro.service.ts`.
 *
 * `destination` is the city the trip is to. It narrows the search and it keeps
 * a hotel of the same name in another country out of the list; it is optional
 * because an address the reader pasted usually carries its own city.
 */
export async function findStays(
  query: string,
  destination?: string,
): Promise<StayCandidate[]> {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  try {
    const body = await http.get<StayResponse>('/places/stay', {
      query: { q: trimmed, ...(destination?.trim() ? { near: destination.trim() } : {}) },
    });

    return (body.candidates ?? [])
      .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng))
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        address: candidate.address,
        coordinates: { lat: candidate.lat, lng: candidate.lng },
      }));
  } catch {
    return [];
  }
}
