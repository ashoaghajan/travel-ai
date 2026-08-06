import { useEffect, useState } from 'react';
import type {
  Activity,
  BookingContext,
  Flight,
  Hotel,
  PartnerCategory,
  PriceSource,
} from '../../types/travel.types';
import { activityService } from '../../services/activity.service';
import { flightService } from '../../services/flight.service';
import { addDays, fromIsoDate, toIsoDate } from '../../utils/date';
import { hotelService } from '../../services/hotel.service';

/**
 * Priced options for the booking screen's current tab.
 *
 * The screen used to offer partner logos and nothing else — the reader had to
 * leave to find out what anything cost. This loads the same searches the
 * flights and hotels screens run, from the `BookingContext` already derived
 * from the last flight search, so the prices are on the page they are chosen on.
 *
 * Only the tab in view is loaded. Fetching all three would spend provider quota
 * on two tabs nobody opened.
 */

const LOAD_ERROR = 'We could not load prices right now. The partner links below still work.';

export type BookingDeals = {
  flights: Flight[];
  hotels: Hotel[];
  activities: Activity[];
  source: PriceSource;
  quotedAt: string | null;
  isLoading: boolean;
  error: string | null;
  /**
   * Whether the trip is described well enough to price at all. False on a first
   * visit, when nothing has been searched — the screen then shows the partner
   * list on its own, as it always did.
   */
  canSearch: boolean;
};

/** Flights need a route and a date; anything less is not a search. */
function canSearchFlights(context: BookingContext): boolean {
  return Boolean(context.originCode && context.destinationCode && context.departDate);
}

/** A two-night stay, when the trip does not say how long to book for. */
const DEFAULT_NIGHTS = 2;

/**
 * Stays need a destination and an arrival date. A departure date is optional.
 *
 * It used to be required, which quietly emptied the Hotels tab for anyone who
 * had searched a one-way flight: `returnDate` is undefined for those, and
 * someone flying one way still has to sleep somewhere.
 */
function canSearchHotels(context: BookingContext): boolean {
  return Boolean(context.destinationCity && context.departDate);
}

/**
 * Things to do need only a place.
 *
 * No date: the listings are attractions rather than departures, so they are
 * the same whichever week the reader is going.
 */
function canSearchActivities(context: BookingContext): boolean {
  return Boolean(context.destinationCity);
}

/** Enough to choose from, few enough to render — matches the explorer. */
const ACTIVITY_LIMIT = 12;

/** When to check out: the return leg, or a short default stay. */
function checkOutDate(departDate: string, returnDate: string | null): string {
  return returnDate ?? toIsoDate(addDays(fromIsoDate(departDate), DEFAULT_NIGHTS));
}

export function useBookingDeals(context: BookingContext, tab: PartnerCategory): BookingDeals {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [source, setSource] = useState<PriceSource>('sample');
  const [quotedAt, setQuotedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSearch =
    tab === 'flights'
      ? canSearchFlights(context)
      : tab === 'hotels'
        ? canSearchHotels(context)
        : canSearchActivities(context);

  // The context is rebuilt on every render of the page, so depend on its
  // fields rather than its identity or this loops forever.
  const { originCode, destinationCode, destinationCity, departDate, returnDate, travellers } =
    context;

  useEffect(() => {
    if (!canSearch) {
      setFlights([]);
      setHotels([]);
      setActivities([]);
      setError(null);
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);

    const load = async () => {
      if (tab === 'flights') {
        const found = await flightService.searchFlights({
          tripType: returnDate ? 'round-trip' : 'one-way',
          from: originCode ?? '',
          to: destinationCode ?? '',
          departDate: departDate ?? '',
          returnDate: returnDate ?? undefined,
          travellers,
        });

        if (!active) return;
        setFlights(found.results);
        setSource(found.source);
        setQuotedAt(found.quotedAt);
        return;
      }

      if (tab === 'hotels') {
        const found = await hotelService.searchHotels({
          destination: destinationCity ?? '',
          checkIn: departDate ?? '',
          checkOut: checkOutDate(departDate ?? '', returnDate),
          guests: travellers,
        });

        if (!active) return;
        setHotels(found.results);
        setSource(found.source);
        setQuotedAt(found.quotedAt);
        return;
      }

      const found = await activityService.getActivities({
        destination: destinationCity ?? '',
        limit: ACTIVITY_LIMIT,
      });

      if (!active) return;
      setActivities(found.activities);
      /*
       * `listing`, the same answer the hotels get: these are real places with
       * real links, and nobody has quoted a price for any of them. Calling it
       * `live` would put a "prices quoted just now" note over a list with no
       * prices in it.
       */
      setSource('listing');
      setQuotedAt(found.fetchedAt);
    };

    load()
      .catch(() => {
        // The services already fall back to samples, so reaching this means
        // something unexpected. The partner list below is still usable.
        if (active) setError(LOAD_ERROR);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    canSearch,
    tab,
    originCode,
    destinationCode,
    destinationCity,
    departDate,
    returnDate,
    travellers,
  ]);

  return { flights, hotels, activities, source, quotedAt, isLoading, error, canSearch };
}
