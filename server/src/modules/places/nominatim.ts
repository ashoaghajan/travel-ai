import { ERROR_CODES } from '@ai-travel/shared';
import { HttpError } from '../../errors';

/**
 * The Nominatim client — OpenStreetMap's geocoder, both directions.
 *
 * **Backwards**, for the explorer: it asks "where am I?" and the device
 * answers with a latitude and a longitude, which is not a thing anybody can
 * pick out of a country dropdown. `reverseGeocode` turns one into the other.
 *
 * **Forwards**, for the planner: "within 2 km of your hotel" is measured from
 * a building, and nothing else here can find one. `/places/geoname` is
 * OpenTripMap's geoname lookup, which resolves *cities* — it knows Tbilisi and
 * has never heard of a hotel in it — so until `searchStays` existed the radius
 * was quietly drawn around the middle of the city and called a hotel.
 *
 * Both halves share the terms, which is most of why they share a file: one
 * User-Agent, one timeout, one place to look when the policy changes.
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
 * How many forward matches to ask for.
 *
 * Nominatim orders by its own relevance, so the useful answer is near the top
 * and the tail is noise. Eight leaves room for several branches of one chain
 * in one city — the case the confirmation list exists for — without turning a
 * yes-or-no into a scrolling exercise.
 */
const MAX_SEARCH_RESULTS = 8;

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

/* ------------------------------------------------------- forwards, for a stay */

export type StayCandidate = {
  /** OSM's own id for the match, unique enough to key a list on. */
  id: string;
  /** The short name, e.g. "Rooms Hotel Tbilisi". */
  name: string;
  /** The rest of the address, for telling two of the same name apart. */
  address: string;
  lat: number;
  lng: number;
};

type SearchResult = {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
};

/**
 * The address without the name repeated at the front of it.
 *
 * `display_name` is "Rooms Hotel, 14, Merab Kostava Street, Tbilisi, Georgia"
 * — the name, then the address. Showing both as given puts the name twice in a
 * row in the list, which reads as a bug rather than as detail.
 */
function addressOf(result: SearchResult): string {
  const full = text(result.display_name) ?? '';
  const name = text(result.name);

  if (name && full.startsWith(`${name}, `)) return full.slice(name.length + 2);

  return full;
}

/** "14", "14A" — OSM's `name` for a building that has only a number. */
const HOUSE_NUMBER = /^\d+[a-z]?$/i;

function toCandidate(result: SearchResult): StayCandidate | null {
  const lat = Number.parseFloat(result.lat ?? '');
  const lng = Number.parseFloat(result.lon ?? '');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let address = addressOf(result);
  // The display name is the only label some matches carry: an address search
  // lands on a building, and a building usually has no name of its own.
  let name = text(result.name) ?? text(address.split(',')[0]);

  if (!name) return null;

  /*
   * A house number is not a label. An address search answers with
   * `name: "14"`, which the caller renders in bold above the street it is on —
   * a list of buildings all called "14" is no easier to choose between than an
   * unlabelled one. The number and its street make a row somebody can read, so
   * they are promoted together and not left in the line below as well.
   */
  if (HOUSE_NUMBER.test(name)) {
    const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
    // `addressOf` has usually taken the number off the front already; when it
    // has not, the street is one segment further along.
    const street = parts[0] === name ? 1 : 0;

    if (parts.length > street) {
      name = `${name} ${parts[street]}`;
      address = parts.slice(street + 1).join(', ');
    }
  }

  return {
    id: String(result.place_id ?? `${result.osm_type ?? 'x'}${result.osm_id ?? ''}`),
    name,
    address,
    lat,
    lng,
  };
}

/**
 * Places matching free text — a hotel name, or a street address.
 *
 * One function for both because they are the same search to Nominatim, and
 * because the address is the fallback for when the name finds nothing: a
 * lookup that could not also take an address would need a second provider for
 * the half of the flow that matters most.
 *
 * **It answers with several, on purpose.** "Hotel Ambassador" is a hotel in
 * most capitals and sometimes twice in one of them, so the caller shows the
 * list and the reader points at the right building. Collapsing that to a best
 * guess here is how a trip gets planned around the wrong one with nothing on
 * screen to say so.
 *
 * **`null` is "could not ask", `[]` is "asked, nothing matched"**, and only
 * the second may be cached — the distinction Overpass taught this codebase the
 * hard way. A day-long cache of an outage is a day of telling everybody their
 * hotel does not exist. It returns rather than throwing, unlike
 * `reverseGeocode`, because a failure here is not an error the reader should
 * see: the next question is "what is its address?" either way.
 */
export async function searchStays(query: string): Promise<StayCandidate[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    limit: String(MAX_SEARCH_RESULTS),
    'accept-language': 'en',
  });

  try {
    const response = await fetch(`${BASE_URL}/search?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as SearchResult[];
    if (!Array.isArray(payload)) return null;

    return payload
      .map(toCandidate)
      .filter((candidate): candidate is StayCandidate => candidate !== null);
  } catch {
    return null;
  }
}
