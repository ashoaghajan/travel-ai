import type { ActivityCategory } from './trip.types';

/**
 * Travel search models — README "Stage 1 Data Models".
 *
 * These are the shapes a real provider (Amadeus, Sabre) would return in
 * Stage 2, so keep them free of view concerns.
 */

/**
 * `Flight`, `Hotel` and the result envelope are the API's wire contract now
 * that the server holds the provider token, so they live in `@ai-travel/shared`
 * and are re-exported here — every existing `types/travel.types` import keeps
 * working unchanged.
 */
export type {
  Airport,
  Flight,
  FlightResults,
  FlightReturnLeg,
  Hotel,
  HotelResults,
  PriceSource,
  SearchResults,
} from '@ai-travel/shared';

export type HotelSearchQuery = {
  destination: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  checkIn: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  checkOut: string;
  guests: number;
};

/**
 * Who took a photo and under what terms. Required rather than optional
 * courtesy: the Creative Commons licences these images carry oblige us to
 * name the author and the licence wherever the picture is shown.
 */
export type ImageCredit = {
  author?: string;
  /** Short licence name, e.g. "CC BY-SA 4.0". */
  license?: string;
  /** The file's page on the source site, carrying the full terms. */
  sourceUrl: string;
};

export type Activity = {
  id: string;
  title: string;
  /**
   * README types this as `string`; it is narrowed to the shared
   * `ActivityCategory` union so the explorer's chips and an itinerary day
   * speak the same vocabulary.
   */
  category: ActivityCategory;
  description: string;
  /** Per person, in USD. Zero when no price is known. */
  price: number;
  /** Out of 5. Zero when the source has no rating. */
  rating: number;
  /** Zero when the source has no review count. */
  reviews: number;
  image: string;
  /**
   * Set only when `image` is a real photograph of this place. Bundled
   * category artwork is credited once in `src/assets/CREDITS.md` instead.
   */
  imageCredit?: ImageCredit;
  /** Where the place is, when the source provides it. */
  coordinates?: {
    lat: number;
    lng: number;
  };
  /** Link back to the source record, for attribution. */
  sourceUrl?: string;
};

/** What a booking partner covers — also the Screen 7 tabs. */
export type PartnerCategory = 'flights' | 'hotels' | 'activities';

/** Selects which deep-link builder in `partner.links.ts` a partner uses. */
export type PartnerLinkBuilderId = 'expedia' | 'booking' | 'trip' | 'getyourguide';

export type Partner = {
  id: string;
  name: string;
  description: string;
  /** Every category this partner appears under. */
  categories: PartnerCategory[];
  /** Placeholder logo tile: brand colour and the initials drawn on it. */
  brandColor: string;
  brandTextColor: string;
  initials: string;
  linkBuilder: PartnerLinkBuilderId;
  /** Where "View Deals" goes when there is too little to build a search URL. */
  homeUrl: string;
};

/**
 * What we know about the trip when the reader reaches the booking screen.
 *
 * Derived from the last flight search, which is the only place the app records
 * an origin. Every field is nullable because a first visit has none of them —
 * the builders fall back to the partner's home page rather than emitting a
 * half-filled search.
 */
export type BookingContext = {
  tripType: TripType;
  /** Origin IATA code. */
  originCode: string | null;
  /** Destination IATA code. */
  destinationCode: string | null;
  /** City name, for the hotel and activity partners that do not take IATA. */
  destinationCity: string | null;
  /**
   * The destination country, as the trip names it — "Armenia", not "AM".
   *
   * Carried so a trip that names only a city can still be flown to: it is
   * what `useDestinationAirport` narrows the airport search to. That country
   * and only that country — a trip to Armenia is not flown into Georgia, and
   * resolving one there would price a journey nobody asked for.
   */
  destinationCountry: string | null;
  /** ISO calendar date, `YYYY-MM-DD`. */
  departDate: string | null;
  returnDate: string | null;
  /** Adults. `FlightSearchQuery` carries no children or infants. */
  travellers: number;
};

export type TripType = 'round-trip' | 'one-way' | 'multi-city';

export type FlightSearchQuery = {
  tripType: TripType;
  /** Origin IATA code. */
  from: string;
  /** Destination IATA code. */
  to: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  departDate: string;
  /** ISO calendar date; absent for one-way and multi-city searches. */
  returnDate?: string;
  travellers: number;
};
