/**
 * OpenTripMap HTTP client.
 *
 * Knows the API and nothing about our domain: it returns OpenTripMap-shaped
 * data, and `activity.service.ts` maps that into the `Activity` model. No
 * React component may import this file.
 *
 * API: https://dev.opentripmap.org/docs
 */

const BASE_URL = 'https://api.opentripmap.com/0.1/en/places';

/** Per-request timeout — a hung request must not leave the grid spinning. */
const REQUEST_TIMEOUT_MS = 10_000;

export class OpenTripMapError extends Error {
  /** HTTP status, when the failure came from a response rather than the network. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenTripMapError';
    this.status = status;
  }
}

/**
 * The API has no such place.
 *
 * Worth its own type because it is a durable fact — "Departure" is never going
 * to become a town — whereas a timeout says nothing about the place at all.
 * The geocode cache remembers one and retries the other.
 */
export class UnknownPlaceError extends OpenTripMapError {
  constructor(name: string) {
    super(`OpenTripMap does not know a place called "${name}".`);
    this.name = 'UnknownPlaceError';
  }
}

export class MissingApiKeyError extends OpenTripMapError {
  constructor() {
    super('VITE_OPENTRIPMAP_API_KEY is not set. Add it to .env.local and restart the dev server.');
    this.name = 'MissingApiKeyError';
  }
}

/**
 * A place as returned by the radius search — everything the API will give us
 * without a per-place request.
 *
 * There is deliberately no detail type here. `/xid/{id}` is the only endpoint
 * carrying a photo or prose, it takes exactly one id, and there is no bulk
 * form of it — so a grid of ten cards cost ten HTTP requests. `activity.service`
 * builds its cards from this shape instead.
 */
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
  /**
   * Wikidata entity id, when OpenStreetMap has one tagged. The search carries
   * no photo, but this is the key to finding one — see `wikimedia.service`.
   */
  wikidata?: string;
};

/**
 * One place in full, from `/xid/{id}`.
 *
 * This endpoint takes exactly one id and has no bulk form, which is why the
 * grid does not use it — ten cards meant ten requests. Opening a single
 * attraction is the opposite case: one request, asked for deliberately, in
 * exchange for the prose and address the search cannot return.
 */
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

function apiKey(): string {
  const key = import.meta.env.VITE_OPENTRIPMAP_API_KEY;
  if (!key) throw new MissingApiKeyError();
  return key;
}

function buildUrl(path: string, params: Record<string, string | number>): string {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }
  url.searchParams.set('apikey', apiKey());
  return url.toString();
}

async function request<T>(path: string, params: Record<string, string | number>): Promise<T> {
  // Built outside the try so a missing key surfaces as a configuration error
  // rather than being reported as an unreachable network.
  const url = buildUrl(path, params);

  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Offline, DNS failure, CORS rejection or timeout.
    throw new OpenTripMapError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'OpenTripMap did not respond in time.'
        : 'Could not reach OpenTripMap.',
    );
  }

  if (!response.ok) {
    throw new OpenTripMapError(
      response.status === 401
        ? 'OpenTripMap rejected the API key.'
        : `OpenTripMap returned ${response.status}.`,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new OpenTripMapError('OpenTripMap returned a malformed response.');
  }
}

export const openTripMapService = {
  /**
   * Resolves a place name to coordinates.
   *
   * `countryCode` is an ISO 3166-1 alpha-2 filter, and it matters more than it
   * looks: there is a Barcelona in Venezuela and a Valencia in both Spain and
   * Venezuela, and the unfiltered lookup silently picks one.
   */
  async findDestination(name: string, countryCode?: string): Promise<Destination> {
    const result = await request<{
      name?: string;
      lat?: number;
      lon?: number;
      country?: string;
      status?: string;
      error?: string;
    }>('/geoname', countryCode ? { name, country: countryCode } : { name });

    if (typeof result.lat !== 'number' || typeof result.lon !== 'number') {
      throw new UnknownPlaceError(name);
    }

    return { name: result.name ?? name, lat: result.lat, lon: result.lon, country: result.country };
  },

  /**
   * Places of the given kinds within `radius` metres, most notable first.
   *
   * The API orders by distance, so ranking by `rate` happens here — the
   * caller wants the best places nearby, not merely the closest.
   */
  async searchPlaces(options: {
    lat: number;
    lon: number;
    kinds: string;
    radius: number;
    limit: number;
    minRate?: number;
  }): Promise<OpenTripMapPlace[]> {
    const places = await request<OpenTripMapPlace[] | { error?: string }>('/radius', {
      lat: options.lat,
      lon: options.lon,
      kinds: options.kinds,
      radius: options.radius,
      limit: options.limit,
      rate: options.minRate ?? 1,
      format: 'json',
    });

    if (!Array.isArray(places)) return [];

    return places
      .filter((place) => Boolean(place?.xid) && Boolean(place?.name?.trim()))
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  },

  /**
   * Everything about one place: prose, photo, address.
   *
   * Deliberately not used to build lists — see `OpenTripMapPlaceDetails`.
   */
  async getPlaceDetails(xid: string): Promise<OpenTripMapPlaceDetails> {
    return request<OpenTripMapPlaceDetails>(`/xid/${encodeURIComponent(xid)}`, {});
  },
};
