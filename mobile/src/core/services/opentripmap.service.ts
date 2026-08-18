import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError } from './http';
import { http } from './http';

/**
 * The attractions directory, as the SPA sees it.
 *
 * Every call goes to our own `/api/places/*`, which holds the OpenTripMap key
 * and talks to the provider. The key used to be compiled into this bundle as
 * `VITE_OPENTRIPMAP_API_KEY`, readable by anyone who loaded the site; it is
 * now server-side and nothing here knows it exists.
 *
 * The shapes below are still the provider's, unchanged, because
 * `activity.service.ts` maps them into `Activity` and that composition has not
 * moved. No React component may import this file.
 */

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

/**
 * The server has no OpenTripMap key.
 *
 * Kept under its old name because six call sites branch on it and the meaning
 * is unchanged — attractions cannot be looked up until someone configures a
 * key. Only *where* that key lives has moved.
 */
export class MissingApiKeyError extends OpenTripMapError {
  constructor() {
    super('This server has no OpenTripMap key configured.');
    this.name = 'MissingApiKeyError';
  }
}

/** A place as returned by the radius search, ranked most notable first. */
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
 * One place in full.
 *
 * Deliberately not used to build lists: the provider endpoint behind this
 * takes exactly one id and has no bulk form, so a grid of ten cards would cost
 * ten requests. `activity.service` builds its cards from the search shape.
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

/**
 * Turns an API failure back into the error type this module has always thrown.
 *
 * The three cases stay distinguishable across the network because the server
 * gives each its own status: a place that does not exist is a `404`, an unset
 * key is a `503 PROVIDER_NOT_CONFIGURED`, and everything else is transient.
 * `geocode.service` caches the first and retries the third, so collapsing them
 * would make it remember an outage as geography.
 */
function asOpenTripMapError(error: unknown, placeName?: string): OpenTripMapError {
  if (!(error instanceof ApiError)) {
    return new OpenTripMapError('Could not reach the attractions service.');
  }

  if (error.code === ERROR_CODES.PROVIDER_NOT_CONFIGURED) return new MissingApiKeyError();

  if (error.status === 404) return new UnknownPlaceError(placeName ?? 'that place');

  return new OpenTripMapError(
    error.status === 0 ? 'Could not reach the attractions service.' : error.message,
    error.status,
  );
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
    try {
      return await http.get<Destination>('/places/geoname', {
        query: { name, country: countryCode },
      });
    } catch (error) {
      throw asOpenTripMapError(error, name);
    }
  },

  /**
   * Places of the given kinds within `radius` metres, most notable first.
   *
   * The ranking happens server-side now, with the call it belongs to — the
   * provider orders by distance, and a reader wants the best places nearby
   * rather than merely the closest.
   */
  async searchPlaces(options: {
    lat: number;
    lon: number;
    kinds: string;
    radius: number;
    limit: number;
    minRate?: number;
  }): Promise<OpenTripMapPlace[]> {
    try {
      return await http.get<OpenTripMapPlace[]>('/places/search', {
        query: {
          lat: options.lat,
          lon: options.lon,
          kinds: options.kinds,
          radius: options.radius,
          limit: options.limit,
          rate: options.minRate ?? 1,
        },
      });
    } catch (error) {
      throw asOpenTripMapError(error);
    }
  },

  /** Everything about one place: prose, photo, address. */
  async getPlaceDetails(xid: string): Promise<OpenTripMapPlaceDetails> {
    try {
      return await http.get<OpenTripMapPlaceDetails>(
        `/places/detail/${encodeURIComponent(xid)}`,
      );
    } catch (error) {
      throw asOpenTripMapError(error, xid);
    }
  },
};
