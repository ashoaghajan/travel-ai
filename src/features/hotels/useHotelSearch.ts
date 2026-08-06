import { useEffect, useState } from 'react';
import type { Hotel, HotelSearchQuery, PriceSource } from '../../types/travel.types';
import { hotelService } from '../../services/hotel.service';
import { HOTEL_DESTINATION } from '../../mock/hotels';
import { addDays, toIsoDate } from '../../utils/date';

const SEARCH_ERROR = 'We could not load stays right now. Please try again.';

/**
 * Matches the flight screen's lead time, so the two open on the same trip —
 * see `useFlightSearch` for why a fixed May date had to go.
 */
const DEFAULT_LEAD_DAYS = 42;

/** DESIGN_SPEC Screen 5 header: Ubud, a two-night stay, 2 guests. */
function defaultQuery(): HotelSearchQuery {
  const checkIn = addDays(new Date(), DEFAULT_LEAD_DAYS);

  return {
    destination: HOTEL_DESTINATION,
    checkIn: toIsoDate(checkIn),
    checkOut: toIsoDate(addDays(checkIn, 2)),
    guests: 2,
  };
}

export const DEFAULT_HOTEL_QUERY = defaultQuery();

/** Loads the stays for the current search. Filtering and sorting live in the page. */
export function useHotelSearch(query: HotelSearchQuery = DEFAULT_HOTEL_QUERY) {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  // Sample until told otherwise — see the same default in `useFlightSearch`.
  const [source, setSource] = useState<PriceSource>('sample');
  const [quotedAt, setQuotedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError(null);

    hotelService
      .searchHotels(query)
      .then((found) => {
        if (!active) return;
        setHotels(found.results);
        setSource(found.source);
        setQuotedAt(found.quotedAt);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
        setError(SEARCH_ERROR);
      });

    return () => {
      active = false;
    };
  }, [query]);

  return {
    hotels,
    query,
    source,
    quotedAt,
    error,
    isLoading: status === 'loading',
  };
}
