import type { Booking } from '../types/booking.types';
import type { ItineraryDay, LatLng, Trip } from '../types/trip.types';
import type { BookingTotals, TripPricing } from './booking';
import { bookingTotals } from './booking';
import { formatCurrency } from './currency';
import { nightsBetween } from './date';
import { centroidOf, isPlottable } from './map';

/** "1 Traveller" / "2 Travellers" — DESIGN_SPEC Screen 3 capitalisation. */
export function formatTravellers(count: number): string {
  return `${count} ${count === 1 ? 'Traveller' : 'Travellers'}`;
}

/** "1 day" / "7 days" */
export function formatDayCount(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/** "1 night" / "6 nights" */
export function formatNightCount(count: number): string {
  return `${count} ${count === 1 ? 'night' : 'nights'}`;
}

export type TripCosts = {
  flights: number;
  hotels: number;
  activities: number;
  total: number;
  /** Nights billed for accommodation — a 7-day trip is 6 nights. */
  nights: number;
  /** How many activities the itinerary contains, for the cost row label. */
  activityCount: number;
};

function countActivities(itinerary: ItineraryDay[]): number {
  return itinerary.reduce((total, day) => total + day.activities.length, 0);
}

function sumActivityPrices(itinerary: ItineraryDay[]): number {
  return itinerary.reduce(
    (total, day) =>
      total + day.activities.reduce((sum, activity) => sum + (activity.priceEstimate ?? 0), 0),
    0,
  );
}

/**
 * Cost breakdown for the trip summary (DESIGN_SPEC Screen 8).
 *
 * Estimates stored on the trip win; if one is missing — an older saved trip,
 * or a Stage 2 payload that omits it — activities are recomputed from the
 * itinerary so the total is never silently short.
 */
export function calculateTripCosts(trip: Trip): TripCosts {
  const flights = trip.flightsEstimate ?? 0;
  const hotels = trip.hotelsEstimate ?? 0;
  const activities =
    trip.activitiesEstimate ?? sumActivityPrices(trip.itinerary) * trip.travellers;

  return {
    flights,
    hotels,
    activities,
    total: flights + hotels + activities,
    nights: nightsBetween(trip.startDate, trip.endDate),
    activityCount: countActivities(trip.itinerary),
  };
}

/** What a trip contributes to pricing the bookings filed against it. */
export function tripPricing(trip: Trip): TripPricing {
  return {
    nights: nightsBetween(trip.startDate, trip.endDate),
    travellers: trip.travellers,
  };
}

/**
 * Where a trip's headline number came from.
 *
 * Carried rather than inferred, because the two are different claims and a
 * screen has to be able to label which it is showing. "$828 saved" is a fact
 * about what the reader picked; "$2,100 estimated" is a guess the planner made.
 */
export type TripTotalBasis =
  /** Summed from the prices on saved bookings. */
  | 'bookings'
  /** The planner's estimate, because nothing saved carries a price yet. */
  | 'estimate'
  /** Neither. A hand-made trip with nothing priced attached to it. */
  | 'none';

export type TripTotal = BookingTotals & {
  amount: number;
  basis: TripTotalBasis;
};

/**
 * What a trip costs, preferring what the reader actually chose.
 *
 * Bookings win over estimates whenever any of them carry a price: a fare
 * someone looked at and kept is a better answer than a number the planner
 * guessed before the trip existed. The estimate is the fallback rather than
 * the headline, and `basis: 'none'` is an honest third answer — hand-made
 * trips deliberately store no estimates (see `createTrip.ts`), so a brand new
 * trip has nothing to show and should show nothing rather than `$0`.
 */
export function tripTotal(trip: Trip, bookings: Booking[]): TripTotal {
  // Only used for rows saved before `priceBasis` existed; a row that carries
  // its own basis ignores this entirely.
  const totals = bookingTotals(bookings, tripPricing(trip));
  if (totals.priced > 0) return { ...totals, amount: totals.total, basis: 'bookings' };

  const estimated = calculateTripCosts(trip).total;

  return {
    ...totals,
    amount: estimated,
    basis: estimated > 0 ? 'estimate' : 'none',
  };
}

/**
 * The trip's total as a screen says it: "$828 saved", "$2,100 estimated".
 *
 * Null when there is nothing to claim, so a caller renders nothing rather than
 * a zero. One function because three surfaces show this and copy that drifts
 * between them reads as three different numbers.
 *
 * "Saved" is a claim about money the reader has committed, and a total built
 * from any invented price cannot make it. `bookingTotals` already reports
 * whether one is in there — sample fares from the flight fallback, and stops
 * carried over from the planner's own estimates — so such a total is reported
 * as an estimate, which is what it is. Without this the eleven guesses on an
 * AI-planned trip would add up to a figure labelled as spent.
 */
export function formatTripTotal(total: TripTotal): string | null {
  if (total.basis === 'none') return null;

  const isCommitted = total.basis === 'bookings' && !total.hasSample;

  return `${formatCurrency(total.amount)} ${isCommitted ? 'saved' : 'estimated'}`;
}

export type ItineraryStop = {
  id: string;
  destination: string;
  /** Day numbers spent at this stop, in order. */
  dayNumbers: number[];
  /** "Day 1-2 Ubud" / "Day 3 Nusa Penida" — DESIGN_SPEC Screen 3 map labels. */
  label: string;
  /**
   * Where this stop is, when the itinerary already knows.
   *
   * Absent for a stop that is only a name — which is most of them, since the
   * planner writes no coordinates. The map resolves those by geocoding.
   */
  coordinates?: LatLng;
};

/**
 * A stop's own point, else the centre of the attractions planned there.
 *
 * A day that carries its own point wins: it is a statement about the day,
 * whereas the centroid is inferred from whatever happened to be added. In
 * practice only explorer-imported activities have coordinates at all.
 */
function stopCoordinates(days: ItineraryDay[]): LatLng | undefined {
  const declared = days.find((day) => isPlottable(day.coordinates))?.coordinates;
  if (declared) return declared;

  return centroidOf(days.flatMap((day) => day.activities.map((activity) => activity.coordinates)));
}

/**
 * Collapses consecutive days at the same destination into one stop, which is
 * how the route reads on the map.
 */
export function groupItineraryStops(itinerary: ItineraryDay[]): ItineraryStop[] {
  // The days are kept alongside each stop while grouping, because the stop's
  // position comes from them and a stop itself carries no reference back.
  const groups: { stop: ItineraryStop; days: ItineraryDay[] }[] = [];

  for (const day of itinerary) {
    const previous = groups.at(-1);

    if (previous && previous.stop.destination === day.destination) {
      previous.stop.dayNumbers.push(day.dayNumber);
      previous.days.push(day);
    } else {
      groups.push({
        stop: {
          id: day.id,
          destination: day.destination,
          dayNumbers: [day.dayNumber],
          label: '',
        },
        days: [day],
      });
    }
  }

  return groups.map(({ stop, days }) => {
    const first = stop.dayNumbers[0];
    const last = stop.dayNumbers.at(-1);
    const label = last && last !== first ? `Day ${first}-${last}` : `Day ${first}`;

    return {
      ...stop,
      label: `${label} ${stop.destination}`,
      coordinates: stopCoordinates(days),
    };
  });
}
