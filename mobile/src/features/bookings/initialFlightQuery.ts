import type { FlightSearchQuery } from '../../core/types/travel.types';
import { searchService } from '../../core/services/search.service';
import { DEFAULT_DESTINATION, DEFAULT_ORIGIN } from '../../core/mock/airports';
import { addDays, toIsoDate } from '../../core/utils/date';

/**
 * The search the booking form opens on.
 *
 * A copy of the web's `useFlightSearch.initialFlightQuery` and the default it
 * falls back to. Not in `core/` and not covered by `core-copies.test.ts`,
 * because on the web these live inside `useFlightSearch` — a hook that runs a
 * flight search this app has no screen for. Copying the whole hook to reach
 * two of its lines would bring `flightService` polling with it.
 *
 * When `/flights` arrives on this side, this file is what it should start from.
 */

/**
 * How far ahead the opening search looks.
 *
 * DESIGN_SPEC Screen 4 names May 20 - May 28, which was fine against mock data
 * and is not against a real one: the provider serves a cache of fares already
 * found, and that cache runs about three months deep. A fixed date in a future
 * May is ten months out for most of the year, so the screen would open on "No
 * flights for this route" every time.
 */
const DEFAULT_LEAD_DAYS = 42;

/** DESIGN_SPEC Screen 4 defaults: JFK → DPS, an eight-day trip, 2 adults. */
function defaultQuery(): FlightSearchQuery {
  const depart = addDays(new Date(), DEFAULT_LEAD_DAYS);

  return {
    tripType: 'round-trip',
    from: DEFAULT_ORIGIN,
    to: DEFAULT_DESTINATION,
    departDate: toIsoDate(depart),
    // Derived from the departure so the two dates can never cross a year
    // boundary apart.
    returnDate: toIsoDate(addDays(depart, 8)),
    travellers: 2,
  };
}

/**
 * Whatever was searched last on this device, falling back to the spec defaults.
 *
 * Computed per call rather than held in a module constant: the default is
 * relative to today, and a phone app is suspended and resumed for weeks rather
 * than reloaded, so a constant evaluated at import would drift into the past.
 */
export function initialFlightQuery(): FlightSearchQuery {
  return searchService.getLastFlightSearch() ?? defaultQuery();
}
