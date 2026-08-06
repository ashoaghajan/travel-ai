import type { Trip } from '../../types/trip.types';
import type { BookingContext, FlightSearchQuery } from '../../types/travel.types';
import { normaliseName } from '../../services/explore.service';
import { toBookingContext } from './partner.links';

/**
 * Which trip the booking screen is filling for, and the search context that
 * follows from it.
 *
 * Mirrors `exploreService.resolveSelection`, including its `source`
 * discriminator, because the problem is the same one: an explicit choice has
 * to outrank the trip the reader last opened, and the screen has to be able to
 * say which it used.
 *
 * The merge is a merge and not a swap. A trip knows where you are going but
 * not where you are leaving from — the comment on `toBookingContext` says so —
 * so the origin keeps coming from the last flight search whatever trip is
 * chosen. What a trip does supply, and a flight query only approximates, is
 * real check-in and check-out dates for the Hotels tab.
 */

/**
 * The `?tripId=` value meaning "deliberately no trip".
 *
 * Necessary because an *absent* parameter already means "fall back to the trip
 * I last opened". Detaching needs a value that survives a reload and outranks
 * the active trip, which nothing absent can do.
 */
export const NO_TRIP = 'none';

export type BookingContextSource =
  /** An explicit `?tripId=`. */
  | 'requested'
  /** The trip the reader last opened. */
  | 'trip'
  /** No trip; the last flight search alone. */
  | 'search'
  /** Nothing known at all. */
  | 'none';

export type ResolvedBookingContext = {
  context: BookingContext;
  /** The trip being filled for, or null when filling for nobody. */
  trip: Trip | null;
  source: BookingContextSource;
};

/** Case- and spacing-insensitive, so "  Bali " and "bali" are one place. */
function sameCity(a: string | null, b: string | null): boolean {
  const left = normaliseName(a)?.toLowerCase();
  const right = normaliseName(b)?.toLowerCase();

  return Boolean(left && right && left === right);
}

/** A trip's city, falling back to the single `destination` old trips carry. */
function tripCity(trip: Trip): string | null {
  return normaliseName(trip.destinationCity) ?? normaliseName(trip.destination);
}

export function resolveBookingContext(
  trips: Trip[],
  activeTripId: string | null,
  lastSearch: FlightSearchQuery | null,
  requestedTripId?: string | null,
): ResolvedBookingContext {
  const base = toBookingContext(lastSearch);
  const fallbackSource: BookingContextSource = lastSearch ? 'search' : 'none';

  // An explicit detach beats everything, including the active trip.
  if (requestedTripId === NO_TRIP) {
    return { context: base, trip: null, source: fallbackSource };
  }

  const requested = requestedTripId
    ? (trips.find((trip) => trip.id === requestedTripId) ?? null)
    : null;

  // A `?tripId=` naming a trip deleted in another tab falls through to the
  // active one rather than showing an error the reader cannot act on.
  const active = activeTripId ? (trips.find((trip) => trip.id === activeTripId) ?? null) : null;
  const trip = requested ?? active;

  if (!trip) return { context: base, trip: null, source: fallbackSource };

  const city = tripCity(trip);

  return {
    trip,
    source: requested ? 'requested' : 'trip',
    context: {
      ...base,
      // Never overwritten — see the docblock.
      originCode: base.originCode,
      /*
       * The searched airport is kept only when it is in the trip's own city.
       * A leftover DPS on a trip to Barcelona would otherwise produce a
       * confident, wrong flight search; nulled, `canSearchFlights` goes false,
       * the Flights tab falls back to partner links, and the form above it is
       * the prompt to say which airport — which is the honest answer.
       */
      destinationCode: sameCity(base.destinationCity, city) ? base.destinationCode : null,
      destinationCity: city ?? base.destinationCity,
      destinationCountry: trip.destinationCountry ?? base.destinationCountry,
      departDate: trip.startDate || base.departDate,
      returnDate: trip.endDate || base.returnDate,
      travellers: trip.travellers > 0 ? trip.travellers : base.travellers,
      tripType:
        trip.endDate && trip.startDate && trip.endDate > trip.startDate
          ? 'round-trip'
          : base.tripType,
    },
  };
}

/** The `FlightSearchQuery` a resolved context opens the search form on. */
export function toFlightQuery(context: BookingContext): FlightSearchQuery {
  return {
    tripType: context.tripType,
    from: context.originCode ?? '',
    to: context.destinationCode ?? '',
    departDate: context.departDate ?? '',
    returnDate: context.returnDate ?? undefined,
    travellers: context.travellers,
  };
}
