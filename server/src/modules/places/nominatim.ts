import { ERROR_CODES } from '@ai-travel/shared';
import { HttpError } from '../../errors';

/**
 * The Nominatim client — coordinates back into a country and a city.
 *
 * The explorer asks "where am I?" and the device answers with a latitude and a
 * longitude, which is not a thing anybody can pick out of a country dropdown.
 * This turns one into the other.
 *
 * Nominatim rather than a second key: it is OpenStreetMap's own geocoder, it
 * is keyless, and it is the same map data OpenTripMap draws its places from —
 * so a city named here is a city that lookup can find. Its usage policy asks
 * for an identifying User-Agent and no bulk traffic, which is exactly why this
 * is server-side and behind a day-long cache keyed on rounded coordinates:
 * one process asks once per neighbourhood per day, rather than every phone
 * asking for itself every time the explorer opens.
 *
 * API: https://nominatim.org/release-docs/latest/api/Reverse/
 */

const BASE_URL = 'https://nominatim.openstreetmap.org';

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Nominatim blocks requests that do not identify their sender, and it means
 * it: an absent or generic User-Agent is a 403 rather than a slow lane.
 */
const USER_AGENT = 'ai-travel-planner/1.0 (+https://travel-ai-io1t.onrender.com)';

/**
 * Nominatim's zoom is a *granularity* rather than a map scale: 18 answers with
 * a house number nobody selected a country with, and 10 asks for the
 * administrative area containing the point.
 *
 * 14 rather than 10, and the difference is not subtlety — it is correctness.
 * At 10 the match is whatever boundary encloses the point, and OpenStreetMap
 * has boundaries tagged as cities that nobody would name as one: Al Maryah
 * Island, a business district of Abu Dhabi, is `addresstype: city`, so a fix
 * there came back as "Al Maryah Island" with Abu Dhabi demoted to `county`.
 * At 14 the match is the neighbourhood, and a neighbourhood's *address*
 * carries the real city above it — `city: "Abu Dhabi"`, with the island where
 * it belongs, in `suburb`.
 */
const CITY_ZOOM = 14;

export type ReversePlace = {
  /** ISO 3166-1 alpha-2, uppercased, or null when the point is at sea. */
  countryCode: string | null;
  /** OSM's own name for the country — a fallback; see `reference.routes`. */
  countryName: string | null;
  /**
   * Every name at this point that could be the city, widest sense, most
   * specific first. Offered as a list rather than an answer because deciding
   * between them needs the city list, which lives in `reference.routes`.
   */
  candidates: string[];
  /**
   * The best name from the fields that genuinely mean *a settlement*, or null.
   *
   * What is answered with when the city list recognises none of the candidates
   * — so a point OSM knows only as a district falls back to nothing rather
   * than to the district. Half an answer, a country and no city, is a working
   * screen; a neighbourhood in the city box is a wrong one.
   */
  settlement: string | null;
};

/**
 * The address fields that name a settlement, most specific first.
 *
 * A point can land in any of these depending on how the local mapping
 * community models places: a Japanese address carries `city`, a rural French
 * one only `village`, and an Italian one `municipality`.
 */
const SETTLEMENT_FIELDS = ['city', 'town', 'village', 'municipality'] as const;

/**
 * The rest of the hierarchy, which is worth *checking* but never worth
 * answering with unchecked.
 *
 * `county` earns its place here: where OSM has mis-tagged a district as a city
 * — see `CITY_ZOOM` — the real city is often sitting in `county`, and the city
 * list is what tells the two apart. `suburb` is deliberately absent from both
 * lists: some genuine neighbourhoods share a name with a listed city, and
 * preferring one would put a district in the box for a reader standing in the
 * city itself.
 */
const AREA_FIELDS = ['city_district', 'county', 'state'] as const;

type AddressField = (typeof SETTLEMENT_FIELDS)[number] | (typeof AREA_FIELDS)[number];

type NominatimAddress = Partial<Record<AddressField, unknown>> & {
  country?: unknown;
  country_code?: unknown;
};

type ReverseResponse = { error?: unknown; address?: NominatimAddress };

function unavailable(): HttpError {
  return new HttpError(502, ERROR_CODES.INTERNAL, 'We could not work out where you are.');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Coordinates back into a place, or a place of nulls when the point is nowhere. */
export async function reverseGeocode(lat: number, lon: number): Promise<ReversePlace> {
  const query = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    zoom: String(CITY_ZOOM),
    addressdetails: '1',
    // English, so the answer can be matched against the English country list
    // the explorer's dropdown is built from.
    'accept-language': 'en',
  });

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}/reverse?${query}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }

  if (!response.ok) throw unavailable();

  let payload: ReverseResponse;

  try {
    payload = (await response.json()) as ReverseResponse;
  } catch {
    throw unavailable();
  }

  // A point in the middle of an ocean is answered with `{ error: "Unable to
  // geocode" }` and a 200. That is a fact about the coordinate, not a failure
  // of the lookup, so it comes back as a place nobody is in rather than a 502.
  const address = payload.error || !payload.address ? {} : payload.address;

  const code = text(address.country_code);
  const settlements = SETTLEMENT_FIELDS.map((field) => text(address[field])).filter(
    (name): name is string => name !== null,
  );
  const areas = AREA_FIELDS.map((field) => text(address[field])).filter(
    (name): name is string => name !== null,
  );

  return {
    countryCode: code && code.length === 2 ? code.toUpperCase() : null,
    countryName: text(address.country),
    // De-duplicated: an address routinely repeats a name across two levels —
    // Abu Dhabi is both the city and the county — and one entry is all a
    // caller checking them in order can use.
    candidates: [...new Set([...settlements, ...areas])],
    settlement: settlements[0] ?? null,
  };
}
