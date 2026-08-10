import { ERROR_CODES } from '@ai-travel/shared';
import { HttpError } from '../../errors';
import { env } from '../../env';

/**
 * The OpenTripMap client.
 *
 * This module exists for one reason above the others: the key used to be
 * compiled into the browser bundle as `VITE_OPENTRIPMAP_API_KEY`, where anyone
 * who loaded the site could read it. It now lives here and never leaves the
 * server. The second reason is quota — one process caching one answer serves
 * every reader, where a per-browser cache spent the allowance again for each.
 *
 * Speaks the provider's dialect and nothing of ours. The client's
 * `activity.service.ts` still does the mapping into `Activity`, so this returns
 * OpenTripMap-shaped rows unchanged.
 *
 * API: https://dev.opentripmap.org/docs
 */

const BASE_URL = 'https://api.opentripmap.com/0.1/en/places';

/** A hung provider must not leave the grid spinning. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Thrown when the key is unset — a configuration fact, not a failure. */
export function placesNotConfigured(): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.PROVIDER_NOT_CONFIGURED,
    'Attraction listings are not configured on this server.',
  );
}

export function isPlacesConfigured(): boolean {
  return Boolean(env().OPENTRIPMAP_API_KEY);
}

/**
 * A GET against OpenTripMap, with the key attached.
 *
 * Exported because the hotel search needs the same provider — `travel/hotels.ts`
 * reads lodging out of the same places directory. One client, one key, one
 * place to change when the provider does.
 */
export async function placesGet<T>(
  path: string,
  query: Record<string, string | number>,
): Promise<T> {
  const key = env().OPENTRIPMAP_API_KEY;
  if (!key) throw placesNotConfigured();

  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  url.searchParams.set('apikey', key);

  let response: Response;

  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // Offline, DNS, TLS or timeout: unreachable rather than unhappy.
    throw new HttpError(
      502,
      ERROR_CODES.INTERNAL,
      cause instanceof Error && cause.name === 'TimeoutError'
        ? 'Our places partner did not respond in time.'
        : 'We could not reach our places partner.',
    );
  }

  if (!response.ok) {
    // A rejected key is ours to fix, not the reader's, so it is reported as a
    // configuration problem rather than as "the provider is down".
    if (response.status === 401 || response.status === 403) throw placesNotConfigured();

    throw new HttpError(502, ERROR_CODES.INTERNAL, 'Our places partner returned an error.');
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError(502, ERROR_CODES.INTERNAL, 'Our places partner returned a malformed reply.');
  }
}

/* ------------------------------------------------------------ the provider's shapes */

export type OpenTripMapPlace = {
  xid: string;
  name: string;
  /** Importance score 0–3; higher is more notable. */
  rate: number;
  /** Comma-separated taxonomy, e.g. "beaches,natural,interesting_places". */
  kinds: string;
  /** Metres from the search centre. */
  dist?: number;
  point?: { lon: number; lat: number };
  /** Wikidata entity id, when OpenStreetMap has one tagged. */
  wikidata?: string;
};

export type OpenTripMapPlaceDetails = {
  xid: string;
  name?: string;
  /** A string here — "3" or "3h" for UNESCO heritage — unlike the search. */
  rate?: string | number;
  kinds?: string;
  point?: { lon: number; lat: number };
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    county?: string;
    road?: string;
    suburb?: string;
  };
  preview?: { source?: string; width?: number; height?: number };
  wikipedia_extracts?: { text?: string; title?: string };
  info?: { descr?: string };
  wikidata?: string;
  image?: string;
  otm?: string;
};

export type Destination = {
  name: string;
  lat: number;
  lon: number;
  country?: string;
};

/* ----------------------------------------------------------------- operations */

/**
 * The API has no such place.
 *
 * A durable fact — "Departure" is never going to become a town — which is why
 * it is a 404 rather than a 502. The client's geocode cache remembers this
 * answer and retries a timeout, and it can only tell them apart by status.
 */
export function unknownPlace(name: string): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.NOT_FOUND,
    `OpenTripMap does not know a place called "${name}".`,
  );
}

/**
 * Resolves a place name to coordinates.
 *
 * `countryCode` is an ISO 3166-1 alpha-2 filter, and it matters more than it
 * looks: there is a Barcelona in Venezuela and a Valencia in both Spain and
 * Venezuela, and the unfiltered lookup silently picks one.
 */
export async function findDestination(name: string, countryCode?: string): Promise<Destination> {
  const result = await placesGet<{
    name?: string;
    lat?: number;
    lon?: number;
    country?: string;
    status?: string;
  }>('/geoname', countryCode ? { name, country: countryCode } : { name });

  if (typeof result.lat !== 'number' || typeof result.lon !== 'number') throw unknownPlace(name);

  return { name: result.name ?? name, lat: result.lat, lon: result.lon, country: result.country };
}

export type PlaceSearch = {
  lat: number;
  lon: number;
  kinds: string;
  radius: number;
  limit: number;
  minRate: number;
};

/**
 * Places of the given kinds within `radius` metres, most notable first.
 *
 * The provider orders by distance, so the ranking by `rate` happens here — a
 * reader wants the best places nearby, not merely the closest. This ordering
 * moved server-side with the rest of the call so there is one answer to cache
 * rather than one answer plus a client that re-sorts it.
 */
export async function searchPlaces(search: PlaceSearch): Promise<OpenTripMapPlace[]> {
  const places = await placesGet<OpenTripMapPlace[] | { error?: string }>('/radius', {
    lat: search.lat,
    lon: search.lon,
    kinds: search.kinds,
    radius: search.radius,
    limit: search.limit,
    rate: search.minRate,
    format: 'json',
  });

  if (!Array.isArray(places)) return [];

  return places
    .filter((place) => Boolean(place?.xid) && Boolean(place?.name?.trim()))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
}

/** Everything about one place: prose, photo, address. */
export async function getPlaceDetails(xid: string): Promise<OpenTripMapPlaceDetails> {
  return placesGet<OpenTripMapPlaceDetails>(`/xid/${encodeURIComponent(xid)}`, {});
}
