import type { Booking } from '../types/booking.types';
import type { PlanningContext } from './itinerary.planner';
import type { TripBrief } from '../types/planner.types';
import { bookingService } from './booking.service';
import { distanceKm } from './itinerary.planner';
import { geocodeService } from './geocode.service';
import { getMetroStations } from './metro.service';

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
 * How far from the city a booked stay may be and still be *this* trip's hotel.
 *
 * A stay is matched to a destination by geocoding its name, and a name is a
 * weak key: "Grand Hotel" is a hotel in most countries. Without this check, a
 * Paris booking somebody has not yet attached to a trip could become the
 * centre of a Tokyo itinerary and quietly exclude all of Tokyo from it.
 *
 * Sixty kilometres rather than something tighter, because a legitimate stay
 * can be well outside the middle: an airport hotel, a resort along the coast,
 * a village somebody is using as a base.
 */
const MAX_STAY_FROM_CENTRE_KM = 60;

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
 * The hotel, or the middle of the city standing in for one.
 *
 * The centre is looked up either way, because it is both the fallback and the
 * sanity check on the stay — see `MAX_STAY_FROM_CENTRE_KM`. Undefined only
 * when the destination itself cannot be geocoded, which is the same condition
 * that leaves a trip's stops off the map.
 */
async function resolveBase(brief: TripBrief): Promise<PlanningContext['base']> {
  const centre = await geocodeService.locate(brief.destination).catch(() => null);
  if (!centre) return undefined;

  const stay = chooseStay(await loadBookings(), brief.startDate);
  if (!stay) return { coordinates: centre, source: 'centre' };

  const point = await geocodeService.locate(stay.title).catch(() => null);

  if (!point || distanceKm(point, centre) > MAX_STAY_FROM_CENTRE_KM) {
    return { coordinates: centre, source: 'centre' };
  }

  return { coordinates: point, source: 'stay' };
}
