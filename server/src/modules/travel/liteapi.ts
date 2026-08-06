import { roomsFor } from '@ai-travel/shared';
import { env } from '../../env';

/**
 * The LiteAPI client — the provider that finally quotes a hotel price.
 *
 * Two calls, because LiteAPI splits inventory from pricing: `data/hotels`
 * turns a point into properties, and `hotels/min-rates` turns those properties
 * into the cheapest rate each will sell for. They join on `hotelId`, which is
 * the reason this reads more simply than pricing over a foreign directory
 * would — both halves come from the same catalogue, so there is no name to
 * match and nothing to guess.
 *
 * Optional throughout. Without a key every function here answers "nothing",
 * and `hotels.ts` falls back to unpriced OpenTripMap listings.
 *
 * Nothing here knows what a `Hotel` is — it speaks the provider's dialect and
 * returns rows, on the same split as `travelpayouts.ts`. The caller maps.
 *
 * API: https://docs.liteapi.travel/reference/overview
 */

const BASE_URL = 'https://api.liteapi.travel/v3.0';

/** Metres. The provider's floor is 1000; this matches the OpenTripMap radius. */
const SEARCH_RADIUS_M = 15_000;

/** Rates are asked for by id, and a long list is a slow call. */
const MAX_RATED_HOTELS = 25;

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Whose taxes and fees the quote should include.
 *
 * Rates are nationality-dependent — a booking site shows different totals to
 * different passports — and the field is required, so something has to be
 * chosen. "US" is the provider's own default in its examples. It is a real
 * approximation rather than a neutral one, which is worth remembering if the
 * quoted total is ever compared against a partner site set to somewhere else.
 */
const GUEST_NATIONALITY = 'US';

export function isLiteApiConfigured(): boolean {
  return Boolean(env().LITEAPI_KEY);
}

/* ----------------------------------------------------------------- fetches */

/**
 * A request against the provider.
 *
 * Returns null for every failure rather than throwing. A pricing provider that
 * is down should cost the reader their prices, not their hotel list — see the
 * fallback in `hotels.ts`.
 */
async function request<T>(
  path: string,
  init: { method: 'GET'; query: Record<string, string | number> } | { method: 'POST'; body: unknown },
): Promise<T | null> {
  const key = env().LITEAPI_KEY;
  if (!key) return null;

  const url = new URL(`${BASE_URL}${path}`);

  if (init.method === 'GET') {
    for (const [name, value] of Object.entries(init.query)) {
      url.searchParams.set(name, String(value));
    }
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.method === 'POST' ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- the search */

type HotelsResponse = {
  data?: {
    id?: string;
    name?: string;
    address?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    stars?: number;
    rating?: number;
    reviewCount?: number;
    main_photo?: string;
    thumbnail?: string;
  }[];
};

type MinRatesResponse = {
  data?: { hotelId?: string; price?: number }[];
};

/**
 * How a party occupies rooms.
 *
 * Re-exported rather than defined here: the client describes this same
 * occupancy to the reader, and the two must not drift. See `@ai-travel/shared`.
 */
export { roomsFor } from '@ai-travel/shared';

/** Whole nights between two ISO dates; at least one, so a rate is never /0. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) return 1;

  return Math.max(1, Math.round((to - from) / 86_400_000));
}

/** One stay as the provider describes it, priced where it would sell. */
export type LiteStay = {
  id: string;
  name: string;
  /** Neighbourhood or street, for the line under the name. */
  address: string;
  /** Out of 5, or 0 when the provider has no guest score. */
  rating: number;
  reviews: number;
  image: string;
  /** Where the property is, when the catalogue says. */
  coordinates?: { lat: number; lng: number };
  /**
   * Nightly cost of the whole party's rooms, or null when nothing was quoted.
   *
   * Null is ordinary: a property with no availability on these dates comes
   * back from the listing call and not from the rates call.
   */
  pricePerNight: number | null;
};

export type StaySearch = {
  lat: number;
  lon: number;
  checkIn: string;
  checkOut: string;
  guests: number;
  limit: number;
};

/**
 * Stays near a point, priced where the provider will quote them.
 *
 * Empty for every failure, which is what sends `hotels.ts` to its fallback.
 */
export async function searchStays(search: StaySearch): Promise<LiteStay[]> {
  const listing = await request<HotelsResponse>('/data/hotels', {
    method: 'GET',
    query: {
      latitude: search.lat,
      longitude: search.lon,
      radius: SEARCH_RADIUS_M,
      limit: Math.max(search.limit, MAX_RATED_HOTELS),
    },
  });

  const stays = (listing?.data ?? [])
    .filter((hotel) => hotel.id && (hotel.name ?? '').trim())
    .slice(0, search.limit);

  if (stays.length === 0) return [];

  const rates = await fetchMinRates(
    stays.map((hotel) => hotel.id!),
    search,
  );

  return stays.map((hotel) => ({
    id: hotel.id!,
    name: hotel.name!.trim(),
    address: (hotel.address ?? hotel.city ?? '').trim(),
    // The provider reports guest score and star rating separately. The guest
    // score is the one the card means by "rating"; stars describe the class of
    // property, not how anyone found it.
    rating: hotel.rating ?? 0,
    reviews: hotel.reviewCount ?? 0,
    image: (hotel.main_photo ?? hotel.thumbnail ?? '').trim(),
    coordinates:
      typeof hotel.latitude === 'number' && typeof hotel.longitude === 'number'
        ? { lat: hotel.latitude, lng: hotel.longitude }
        : undefined,
    pricePerNight: rates.get(hotel.id!) ?? null,
  }));
}

/**
 * Where specific properties are, by catalogue id.
 *
 * For stays saved before the catalogue's coordinates were kept. Their names
 * cannot be geocoded — the app's geocoder is OpenTripMap's `/geoname`, a
 * gazetteer of settlements that has never heard of a particular Holiday Inn —
 * so the id is the only thing that can place them, and it places them exactly.
 */
export async function locateStays(ids: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const points = new Map<string, { lat: number; lng: number }>();

  const wanted = ids.map((id) => id.trim()).filter(Boolean).slice(0, MAX_RATED_HOTELS);
  if (wanted.length === 0) return points;

  const listing = await request<HotelsResponse>('/data/hotels', {
    method: 'GET',
    query: { hotelIds: wanted.join(',') },
  });

  for (const hotel of listing?.data ?? []) {
    if (!hotel.id) continue;
    if (typeof hotel.latitude !== 'number' || typeof hotel.longitude !== 'number') continue;

    points.set(hotel.id, { lat: hotel.latitude, lng: hotel.longitude });
  }

  return points;
}

/**
 * The cheapest nightly rate per property id.
 *
 * `min-rates` rather than the full `rates` call: the cards show one number
 * each, and asking for every room type of every hotel to display the smallest
 * would be a much larger response for the same pixels.
 */
async function fetchMinRates(
  hotelIds: string[],
  search: StaySearch,
): Promise<Map<string, number>> {
  const rates = new Map<string, number>();

  const { rooms, adultsPerRoom } = roomsFor(search.guests);
  const nights = nightsBetween(search.checkIn, search.checkOut);

  const response = await request<MinRatesResponse>('/hotels/min-rates', {
    method: 'POST',
    body: {
      hotelIds: hotelIds.slice(0, MAX_RATED_HOTELS),
      // One entry per room. The provider prices the party, not a headcount.
      occupancies: Array.from({ length: rooms }, () => ({ adults: adultsPerRoom })),
      checkin: search.checkIn,
      checkout: search.checkOut,
      currency: 'USD',
      guestNationality: GUEST_NATIONALITY,
    },
  });

  for (const row of response?.data ?? []) {
    if (!row.hotelId || !Number.isFinite(row.price) || (row.price ?? 0) <= 0) continue;

    // `price` is the total due for the whole stay across every room asked for
    // — the provider is explicit that it is "what the end user will pay". The
    // division by nights is what turns it into the per-night figure the card
    // shows. It is deliberately *not* divided by rooms: the reader wants what
    // their trip costs per night, not what one of their rooms costs.
    rates.set(row.hotelId, Math.round(row.price! / nights));
  }

  return rates;
}
