import { useCallback, useEffect, useState } from 'react';
import type { Flight, FlightSearchQuery, PriceSource } from '../../types/travel.types';
import { flightService } from '../../services/flight.service';
import { searchService } from '../../services/search.service';
import { DEFAULT_DESTINATION, DEFAULT_ORIGIN } from '../../mock/airports';
import { addDays, toIsoDate } from '../../utils/date';

const SEARCH_ERROR = 'We could not load flights right now. Please try again.';

/**
 * How far ahead the opening search looks.
 *
 * DESIGN_SPEC Screen 4 names May 20 - May 28, which was fine against mock
 * data and is not against a real one: the provider serves a cache of fares
 * already found, and that cache runs about three months deep. A fixed date in
 * a future May is ten months out for most of the year, so the screen would
 * open on "No flights for this route" every time.
 *
 * Six weeks keeps the spirit — a plausible trip somebody is planning — and is
 * comfortably inside what can actually be priced.
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
    // Derived from the departure so the two dates can never cross a year boundary apart.
    returnDate: toIsoDate(addDays(depart, 8)),
    travellers: 2,
  };
}

export const DEFAULT_FLIGHT_QUERY = defaultQuery();

/**
 * The query the screen opens with: whatever was searched last on this device,
 * falling back to the spec defaults on a first visit.
 */
export function initialFlightQuery(): FlightSearchQuery {
  return searchService.getLastFlightSearch() ?? DEFAULT_FLIGHT_QUERY;
}

/**
 * Runs a flight search and holds its results. All I/O goes through
 * `flightService`, so Stage 2's provider swap does not reach this hook.
 */
export function useFlightSearch() {
  const [query, setQuery] = useState<FlightSearchQuery>(initialFlightQuery);
  const [results, setResults] = useState<Flight[]>([]);
  // Assume sample until an answer says otherwise: the honest default is the
  // one that admits the prices might be illustrative.
  const [source, setSource] = useState<PriceSource>('sample');
  const [quotedAt, setQuotedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (next: FlightSearchQuery) => {
    setQuery(next);
    setStatus('loading');
    setError(null);

    try {
      const found = await flightService.searchFlights(next);
      setResults(found.results);
      setSource(found.source);
      setQuotedAt(found.quotedAt);
      setStatus('ready');
      // Remembered so the next visit reopens on this search.
      searchService.saveFlightSearch(next);
    } catch {
      setStatus('error');
      setError(SEARCH_ERROR);
    }
  }, []);

  // Show results straight away rather than an empty screen.
  useEffect(() => {
    void search(initialFlightQuery());
  }, [search]);

  return {
    query,
    results,
    source,
    quotedAt,
    error,
    isSearching: status === 'loading',
    search,
  };
}
