import type { Trip } from '../../types/trip.types';

/**
 * Which trips a place from the explorer may be added to.
 *
 * The explorer browses anywhere — that is the point of it — but an attraction
 * in Djibouti has no business on an itinerary for Yerevan, and until now
 * nothing stopped it. The day would silently acquire a stop nine thousand
 * kilometres away, and the trip map would draw a line to it.
 *
 * The test is the **country**, not the city. A day trip out of town is normal
 * travel: Hakone is eighty kilometres from Tokyo and a different prefecture,
 * Dilijan is an hour from Yerevan. Matching on city would reject exactly the
 * kind of stop people add by hand.
 *
 * It blocks only on a mismatch it can *prove*. A trip saved before
 * `destinationCountry` existed carries just a label like "Yerevan"
 * (`explore.service.ts` explains why), and a place whose country is unknown is
 * no better. Guessing in either direction would lock people out of their own
 * trips, so an unknown country is treated as no evidence rather than as
 * evidence of a mismatch.
 */

/** Case and surrounding space are the only differences worth forgiving. */
function normalise(country: string | null | undefined): string | null {
  const value = country?.trim().toLowerCase();
  return value ? value : null;
}

export type TripEligibility =
  | { addable: true }
  /** `reason` names the trip's country, which is what makes the block legible. */
  | { addable: false; reason: string };

/** The trip's country, or null when it was saved before we recorded one. */
export function tripCountry(trip: Trip): string | null {
  return trip.destinationCountry?.trim() || null;
}

export function canAddToTrip(trip: Trip, placeCountry: string | null): TripEligibility {
  const place = normalise(placeCountry);
  const destination = normalise(trip.destinationCountry);

  if (!place || !destination || place === destination) return { addable: true };

  return { addable: false, reason: `goes to ${tripCountry(trip)}` };
}

export function addableTrips(trips: Trip[], placeCountry: string | null): Trip[] {
  return trips.filter((trip) => canAddToTrip(trip, placeCountry).addable);
}
