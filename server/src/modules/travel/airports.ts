import type { Airport } from '@ai-travel/shared';

/**
 * The airport directory behind the search fields.
 *
 * The SPA used to offer eight hardcoded airports, which was right while the
 * fares were invented and wrong the moment a real provider arrived: it will
 * price any route, so the picker should offer any airport.
 *
 * Two static files from the provider, joined once and held for the life of the
 * process. The join matters — an airport record carries a `city_code` but no
 * city *name*, and the city is what the hotel and activity deep links in
 * `partner.links.ts` search on. Without it, booking a stay near MXP would
 * search for "Milano Malpensa Airport" instead of "Milan".
 */

const AIRPORTS_URL = 'https://api.travelpayouts.com/data/en/airports.json';
const CITIES_URL = 'https://api.travelpayouts.com/data/en/cities.json';

type RawAirport = {
  code?: string;
  name?: string;
  city_code?: string;
  country_code?: string;
  /** False for places nothing departs from — about 6,300 of the 10,400. */
  flightable?: boolean;
  /**
   * `airport`, `railway`, `bus`, `heliport` or `harbour`.
   *
   * `flightable` alone is not enough: it is true for Milan's three railway
   * stations, which would then outnumber its two airports in a search for
   * "milan". 3,673 of the 4,059 flightable entries are actual airports.
   */
  iata_type?: string;
  coordinates?: { lat?: number; lon?: number };
};

type RawCity = { code?: string; name?: string };

let directory: Airport[] | null = null;
/** Deduped, so a burst of first requests makes one pair of fetches. */
let inFlight: Promise<Airport[]> | null = null;

async function fetchJson<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);

  return (await response.json()) as T[];
}

async function load(): Promise<Airport[]> {
  try {
    const [airports, cities] = await Promise.all([
      fetchJson<RawAirport>(AIRPORTS_URL),
      fetchJson<RawCity>(CITIES_URL),
    ]);

    const cityNames = new Map<string, string>();
    for (const city of cities) {
      if (city.code && city.name) cityNames.set(city.code, city.name);
    }

    return airports
      // Only places you can actually fly from. Rail and coach stops would make
      // the list longer without making it better.
      .filter(
        (airport) =>
          airport.flightable && airport.iata_type === 'airport' && airport.code && airport.name,
      )
      .map((airport) => ({
        code: airport.code!,
        name: airport.name!,
        city: cityNames.get(airport.city_code ?? '') ?? airport.name!,
        countryCode: airport.country_code ?? '',
        coordinates:
          typeof airport.coordinates?.lat === 'number' &&
          typeof airport.coordinates?.lon === 'number'
            ? { lat: airport.coordinates.lat, lon: airport.coordinates.lon }
            : undefined,
      }));
  } catch {
    // Best-effort, like the airline table: a directory that cannot be fetched
    // must not take the flight search down with it. The client keeps its own
    // small built-in list for exactly this.
    return [];
  }
}

async function all(): Promise<Airport[]> {
  if (directory) return directory;

  inFlight ??= load().then((loaded) => {
    directory = loaded;
    inFlight = null;
    return loaded;
  });

  return inFlight;
}

/** Normalised for comparison: case and accents are not part of a match. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * How well an airport answers a query, lower being better. `null` means no.
 *
 * Ranking exists because the obvious answer has to come first: typing "lon"
 * should offer London before Londrina, and typing "JFK" should not bury it
 * under every airport with "jfk" somewhere in its name.
 */
function rank(airport: Airport, query: string): number | null {
  const code = fold(airport.code);
  const city = fold(airport.city);
  const name = fold(airport.name);

  if (code === query) return 0;
  if (city === query) return 1;
  if (city.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (city.includes(query)) return 4;
  if (name.includes(query)) return 5;

  return null;
}

export async function searchAirports(query: string, limit: number): Promise<Airport[]> {
  const wanted = fold(query);
  if (!wanted) return [];

  const scored: { airport: Airport; score: number }[] = [];

  for (const airport of await all()) {
    const score = rank(airport, wanted);
    if (score !== null) scored.push({ airport, score });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        // Shorter city name first among equal matches: "lon" should offer
        // London before Londolozi, which alphabetical order gets backwards.
        a.airport.city.length - b.airport.city.length ||
        a.airport.city.localeCompare(b.airport.city),
    )
    .slice(0, limit)
    .map((entry) => entry.airport);
}

/**
 * Every airport in one country, nearest a point first when one is given.
 *
 * For choosing a trip's destination airport. The country is a hard filter
 * rather than a ranking: a trip to Armenia cannot sensibly fly into Georgia,
 * and offering it invites a booking nobody wants. Proximity then orders what
 * is left, so a trip to Vanadzor is offered EVN before LWN.
 */
export async function airportsInCountry(
  countryCode: string,
  near?: { lat: number; lon: number },
): Promise<Airport[]> {
  const wanted = countryCode.trim().toUpperCase();
  if (!wanted) return [];

  const inCountry = (await all()).filter((airport) => airport.countryCode === wanted);
  if (!near) return inCountry.sort((a, b) => a.city.localeCompare(b.city));

  // Squared degrees, not kilometres: the ordering is identical and this needs
  // no trigonometry. Anything without a position sorts last rather than first.
  const distance = (airport: Airport) => {
    if (!airport.coordinates) return Number.MAX_SAFE_INTEGER;

    const dLat = airport.coordinates.lat - near.lat;
    const dLon = (airport.coordinates.lon - near.lon) * Math.cos((near.lat * Math.PI) / 180);

    return dLat * dLat + dLon * dLon;
  };

  return inCountry.sort((a, b) => distance(a) - distance(b) || a.city.localeCompare(b.city));
}

/** Resolve specific codes — for showing a saved search's airports by name. */
export async function airportsByCode(codes: string[]): Promise<Airport[]> {
  const wanted = new Set(codes.map((code) => code.toUpperCase()));
  if (wanted.size === 0) return [];

  return (await all()).filter((airport) => wanted.has(airport.code));
}

/** Testing seam — the directory is process-lifetime state. */
export function resetAirportDirectory(): void {
  directory = null;
  inFlight = null;
}
