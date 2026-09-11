import type { Booking } from '../types/booking.types';
import type { PlanningContext } from './itinerary.planner';
import type { TripBrief } from '../types/planner.types';
import type { LatLng } from '../types/trip.types';
import { bookingService } from './booking.service';
import { geocodeService } from './geocode.service';
import { getMetroStations } from './metro.service';
import { findStays } from './stay.service';

/**
 * What the two location rules need looked up before a trip can be planned.
 *
 * `itinerary.planner.ts` is pure and stays that way: it takes a base and a
 * list of stations and applies them. Finding them is this file's job, and it
 * is the impure half — the bookings, the geocoder and the metro endpoint.
 *
 * **Nothing is looked up unless a rule is on.** Both preferences default to
 * off, so for most trips this returns an empty context without touching the
 * network, and the planner behaves exactly as it did before either rule
 * existed.
 */

/**
 * The stay a trip to this destination would be based in.
 *
 * Only unassigned bookings are considered, and that is not a simplification —
 * it is the only case that can arise. A trip is planned before it exists, so
 * nothing can yet be attached to it; a hotel booked in advance of planning is
 * one with `tripId: null`. A stay already filed against some *other* trip
 * belongs to that trip and is not evidence about this one.
 *
 * The nearest check-in to the trip's start date wins, so somebody with two
 * stays booked gets the one they are about to use. Ties fall to the earlier
 * date, which keeps the choice deterministic.
 */
export function chooseStay(bookings: Booking[], startDate: string): Booking | null {
  const stays = bookings.filter(
    (booking) => booking.kind === 'hotel' && booking.tripId === null && booking.title.trim() !== '',
  );

  if (stays.length === 0) return null;

  const start = Date.parse(startDate);

  return stays.reduce((best, stay) => {
    if (!Number.isFinite(start)) return best;

    const bestGap = Math.abs(Date.parse(best.date) - start);
    const gap = Math.abs(Date.parse(stay.date) - start);

    // An undated stay cannot win on proximity, but it can still be the only
    // one there is — which the reduce's seed already handles.
    if (!Number.isFinite(gap)) return best;
    if (!Number.isFinite(bestGap)) return stay;

    return gap < bestGap ? stay : best;
  });
}

/**
 * Everything the location rules need, or as much of it as could be found.
 *
 * Each half fails softly and independently: a base that cannot be resolved
 * leaves the distance rule inert, an empty station list leaves the metro rule
 * inert, and neither failure affects the other or the rest of the trip. That
 * is the same stance the planner takes — a lookup that did not answer is not a
 * preference that excludes.
 */
export async function resolvePlanningContext(brief: TripBrief): Promise<PlanningContext> {
  const { maxDistanceFromHotelKm, nearMetroOnly } = brief.preferences;

  const [base, metroStations] = await Promise.all([
    maxDistanceFromHotelKm === null ? undefined : resolveBase(brief),
    nearMetroOnly ? getMetroStations(brief.destination) : undefined,
  ]);

  return { base, metroStations };
}

/**
 * The bookings, or none.
 *
 * Read through the service rather than the store, because nothing in
 * `services/` may import from `store/` — a store is built on a service and the
 * arrow only points one way. It costs a request, made only when the distance
 * rule is on, which is the price of not inverting that.
 */
async function loadBookings(): Promise<Booking[]> {
  try {
    return await bookingService.getBookings();
  } catch {
    return [];
  }
}

/**
 * A hotel name turned into a point, or null.
 *
 * Through `findStays` rather than `geocodeService`, and the difference is the
 * reason the booked-stay path never really worked: `geocodeService` is
 * OpenTripMap's *geoname* lookup, which resolves cities. It knows Tbilisi and
 * has never heard of a hotel in it, so every stay it was asked to place came
 * back either as nothing or as a town with a similar name.
 *
 * The first match is taken, because there is nobody to ask here — this path
 * runs for a booking the reader did not mention and is not looking at. When
 * somebody *is* in front of the question they are shown the list and pick,
 * which is what `planner.stay.ts` exists to do and why the answer arrives as
 * `hotelLocation` rather than as a name to look up again.
 *
 * The city is passed down so the lookup is bounded to it: "Grand Hotel" is a
 * hotel in forty countries, and without that bound one of them becomes the
 * middle of somebody's trip. See `MAX_STAY_FROM_CENTRE_KM`, which is the same
 * figure the route applies.
 */
async function locateStay(name: string, destination: string): Promise<LatLng | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const [best] = await findStays(trimmed, destination).catch(() => []);

  return best?.coordinates ?? null;
}

/**
 * The hotel, or the middle of the city standing in for one.
 *
 * Four answers in a deliberate order.
 *
 * **A hotel the reader confirmed wins outright**, and costs nothing: it
 * arrives with its coordinates on it, because they picked it off a list of
 * real buildings. Nothing is looked up again — a name resolved twice can come
 * back as two different hotels, and the one they pointed at is the one the
 * radius has to be drawn around.
 *
 * **A bare name is looked up**, for a brief that came from somewhere the
 * confirmation flow did not run — an older conversation, or a test.
 *
 * **A booked stay is the fallback**, for a trip planned without an answer: a
 * seeded conversation, or a radius switched on after the trip was asked for.
 *
 * **The centre stands in for any of them.** That is the promise the settings
 * screen already makes out loud, and it is the more useful of the two wrong
 * answers: a radius around the middle of a city is roughly where a hotel is,
 * where dropping the radius spreads the trip over sixty kilometres.
 *
 * Undefined only when the destination itself cannot be geocoded, which is the
 * same condition that leaves a trip's stops off the map.
 */
async function resolveBase(brief: TripBrief): Promise<PlanningContext['base']> {
  if (brief.hotelLocation) return { coordinates: brief.hotelLocation, source: 'named' };

  const centre = await geocodeService.locate(brief.destination).catch(() => null);
  if (!centre) return undefined;

  const named = brief.hotelName?.trim();

  if (named) {
    const point = await locateStay(named, brief.destination);

    // No falling through to the bookings. Somebody who names a hotel has
    // answered the question, and a stay they booked and did not mention is
    // not a better answer than the one they gave.
    return point
      ? { coordinates: point, source: 'named' }
      : { coordinates: centre, source: 'centre' };
  }

  const stay = chooseStay(await loadBookings(), brief.startDate);
  if (!stay) return { coordinates: centre, source: 'centre' };

  const point = await locateStay(stay.title, brief.destination);

  return point
    ? { coordinates: point, source: 'stay' }
    : { coordinates: centre, source: 'centre' };
}
