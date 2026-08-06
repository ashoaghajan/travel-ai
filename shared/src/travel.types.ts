/**
 * Priced search results, as `GET /api/flights/search` and
 * `GET /api/hotels/search` return them.
 *
 * These live here rather than in the SPA because the server is now the one
 * producing them — it holds the provider token, so it is the only side that
 * can. The client's `src/types/travel.types.ts` re-exports them, which is why
 * moving them cost no import site anything.
 */

export type Airport = {
  /** IATA code, e.g. "JFK". */
  code: string;
  /**
   * The city it serves, e.g. "Milan" for MXP.
   *
   * Not the airport's own name. It is what the hotel and activity deep links
   * search on, and "Milano Malpensa Airport" is not a place to stay.
   */
  city: string;
  /** The airport's full name, e.g. "Milano Malpensa Airport". */
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "IT". Disambiguates same-named cities. */
  countryCode: string;
  /**
   * Where the airport is.
   *
   * Carried so a destination can be offered by proximity: a trip to Vanadzor
   * has no airport of its own, and "the nearest one in Armenia" is a better
   * answer than an alphabetical list. Absent for the few records the provider
   * has no position for.
   */
  coordinates?: { lat: number; lon: number };
};

/**
 * The way back, on a round-trip fare.
 *
 * A round-trip price buys two flights, and quoting one of them under a single
 * set of times said the fare was something it was not. The provider has
 * carried `return_at`, `duration_back` and `return_transfers` all along; this
 * is where they surface.
 *
 * Absent on a one-way fare and on every sample, so its presence is what makes
 * a fare a round trip — the screens test this rather than `returnDate`, which
 * says only which day the way back leaves.
 *
 * The route is the outbound reversed and is deliberately not repeated here:
 * two copies could contradict each other, and only one of them could be right.
 */
export type FlightReturnLeg = {
  /** Display time in the airport's own local zone, e.g. "6:40 AM". */
  departureTime: string;
  arrivalTime: string;
  /** The day the return leg departs, `YYYY-MM-DD`. */
  date: string | null;
  /** Display duration, e.g. "3h 15m". */
  duration: string;
  /** Minutes in the air on the way back. */
  durationMinutes: number;
  stops: number;
};

export type Flight = {
  id: string;
  airline: string;
  /** Origin IATA code. */
  from: string;
  /** Destination IATA code. */
  to: string;
  /** Display time, e.g. "11:30 PM". */
  departureTime: string;
  /** Display time, e.g. "8:15 AM". */
  arrivalTime: string;
  /**
   * The day this fare actually departs, `YYYY-MM-DD`. Null for sample data.
   *
   * Required reading, not decoration. The provider searches a cache of fares
   * previously found rather than live inventory, and that cache rarely holds
   * anything for one specific day — so a search is made by month and comes
   * back with real fares on nearby dates. Without showing this, a fare on the
   * 16th would sit under a header saying the 15th.
   */
  departureDate: string | null;
  /** The return leg's day, or null for a one-way or a sample. */
  returnDate: string | null;
  /**
   * The flight home, when this fare buys one. See {@link FlightReturnLeg}.
   *
   * `duration`, `stops` and the two times above describe the **outbound leg
   * only** — they always have. This is the rest of what the price covers.
   */
  returnLeg?: FlightReturnLeg;
  /** Display duration, e.g. "28h 45m". */
  duration: string;
  stops: number;
  /** Per person, in USD. */
  price: number;
  /** Total minutes in the air, so results sort without parsing `duration`. */
  durationMinutes: number;
  /**
   * Where to book this exact fare, or null when there is no link for it.
   *
   * Null is what keeps a card un-clickable rather than clickable-to-nowhere,
   * so it is required rather than optional: every producer has to decide, and
   * sample data decides null.
   */
  bookingUrl: string | null;
};

export type Hotel = {
  id: string;
  name: string;
  /** Area or neighbourhood, e.g. "Ubud". */
  location: string;
  /** Property type shown next to the location, e.g. "Luxury Resort". */
  category: string;
  /** Out of 5. */
  rating: number;
  reviews: number;
  /**
   * In USD, or null when nobody has quoted one.
   *
   * Null is the normal case for a real stay right now: the listings come from
   * a places directory, which knows where hotels are but not what they cost.
   * The card shows "Price on partner site" rather than inventing a number.
   */
  pricePerNight: number | null;
  image: string;
  /** As on `Flight` — null when there is nowhere to send the reader. */
  bookingUrl: string | null;
  /**
   * Where the property is, when the provider says.
   *
   * Carried so the trip map can pin it exactly. Without this a stay is placed
   * by geocoding its name, which is a guess that fails outright for the small
   * properties a directory lists but a gazetteer has never heard of.
   */
  coordinates?: { lat: number; lng: number };
};

/**
 * Where a set of prices came from.
 *
 * The screens have to be able to tell the reader, because sample prices are
 * invented and would otherwise be indistinguishable from quoted ones. Carried
 * on the result rather than on each row: it describes the answer, not a fare.
 */
export type PriceSource =
  /** A provider quoted these prices. */
  | 'live'
  /** Invented, for layout. Never carries a booking link. */
  | 'sample'
  /**
   * Real places, no prices.
   *
   * The state hotels are in until a pricing provider is available: the
   * listings are genuine and each one links to a real booking page, but
   * nothing has quoted a nightly rate, so none is shown.
   */
  | 'listing';

export type SearchResults<T> = {
  results: T[];
  source: PriceSource;
  /** ISO instant the provider quoted these. Null for samples. */
  quotedAt: string | null;
};

/**
 * A thing to do, as the API hands it over.
 *
 * Deliberately smaller than the SPA's own `Activity`: the client adds a
 * category, artwork and coordinates from its own sources, and duplicating
 * those here would mean two places deciding what an activity looks like.
 */
export type ApiActivity = {
  id: string;
  title: string;
  description: string;
  /** Per person, in USD. Zero when nobody has quoted one. */
  price: number;
  /** Out of 5. Zero when the source has no rating. */
  rating: number;
  reviews: number;
  image: string;
  /** Where to book it, already carrying any affiliate attribution. */
  sourceUrl: string;
};

export type ActivityResults = SearchResults<ApiActivity>;

export type FlightResults = SearchResults<Flight>;
export type HotelResults = SearchResults<Hotel>;
