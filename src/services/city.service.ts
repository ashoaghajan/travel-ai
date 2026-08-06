import { cityListKey, storageService } from './localStorage.service';

/**
 * The cities of one country.
 *
 * Same origin as `country.service` on purpose: this endpoint is keyed by
 * country *name*, so the names have to be the ones that list handed out.
 *
 * These lists are big — France returns close to 16,000 cities, roughly 190 KB
 * once stored — which drives two decisions here. Each country is cached under
 * its own key so one country's list can be dropped without touching another's,
 * and only the most recently used few are kept, because a handful of large
 * countries would otherwise fill a 5 MB quota shared with the user's trips.
 *
 * Free, keyless, and CORS-open. No React component may import this file.
 *
 * API: https://countriesnow.space/api/v0.1/countries/cities/q?country=<name>
 */

const ENDPOINT = 'https://countriesnow.space/api/v0.1/countries/cities/q';

/** City lists move slowly; a week keeps them fresh enough. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bump to invalidate every cached copy after a shape change. */
const CACHE_VERSION = 1;

/**
 * How many countries' lists to keep. The user's trips share this quota, so
 * this is deliberately small — a cache miss costs one request, a full quota
 * costs them a saved trip.
 */
const MAX_CACHED_COUNTRIES = 5;

const REQUEST_TIMEOUT_MS = 10_000;

export class CityLookupError extends Error {
  constructor(message = 'We could not load the list of cities.') {
    super(message);
    this.name = 'CityLookupError';
  }
}

type CitiesCache = {
  version: number;
  fetchedAt: string;
  country: string;
  cities: string[];
};

type CitiesResponse = {
  error?: boolean;
  data?: unknown;
};

function readCache(country: string): CitiesCache | null {
  const cached = storageService.get<CitiesCache | null>(cityListKey(country), null);

  if (
    !cached ||
    cached.version !== CACHE_VERSION ||
    cached.country !== country ||
    !Array.isArray(cached.cities)
  ) {
    return null;
  }

  return cached;
}

function isFresh(cache: CitiesCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

/**
 * Drops the least recently written city lists until only
 * `MAX_CACHED_COUNTRIES - 1` remain, leaving room for the one about to be
 * written. `keep` is never evicted — it is the list being written.
 */
function evictOldest(keep: string): void {
  const entries = storageService
    .cityListKeys()
    .filter((key) => key !== cityListKey(keep))
    .map((key) => ({
      key,
      fetchedAt: storageService.get<CitiesCache | null>(key, null)?.fetchedAt ?? '',
    }))
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));

  const excess = entries.length - (MAX_CACHED_COUNTRIES - 1);
  for (let index = 0; index < excess; index += 1) {
    const entry = entries[index];
    if (entry) storageService.remove(entry.key);
  }
}

function writeCache(country: string, cities: string[]): void {
  try {
    evictOldest(country);
    storageService.set(cityListKey(country), {
      version: CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      country,
      cities,
    } satisfies CitiesCache);
  } catch {
    // Even after eviction the quota can refuse a 190 KB write. The list is
    // still returned to the caller — it just will not survive the reload.
  }
}

function toCities(payload: CitiesResponse | null): string[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  const cities = rows.flatMap((row) => (typeof row === 'string' && row.trim() ? [row.trim()] : []));

  // The source repeats a name when two regions share it; the selector has no
  // way to tell them apart, so one entry is all it can honestly offer.
  return [...new Set(cities)].sort((a, b) => a.localeCompare(b));
}

/** One request per country, shared by concurrent callers. */
const inFlight = new Map<string, Promise<string[]>>();

async function fetchCities(country: string): Promise<string[]> {
  const url = `${ENDPOINT}?country=${encodeURIComponent(country)}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new CityLookupError(`Could not reach the city list for ${country}.`);
  }

  if (!response.ok) throw new CityLookupError(`We could not load the cities of ${country}.`);

  let payload: CitiesResponse;
  try {
    payload = (await response.json()) as CitiesResponse;
  } catch {
    throw new CityLookupError(`We could not load the cities of ${country}.`);
  }

  if (payload.error === true) {
    throw new CityLookupError(`We could not load the cities of ${country}.`);
  }

  return toCities(payload);
}

export const cityService = {
  /**
   * Every city in a country, alphabetically.
   *
   * An empty list is a valid answer — some territories genuinely have no
   * entries — so it is returned rather than treated as a failure. A stale copy
   * beats an error when the network is the thing that broke.
   */
  async getCities(country: string, options: { forceRefresh?: boolean } = {}): Promise<string[]> {
    const name = country.trim();
    if (!name) return [];

    const cached = readCache(name);
    if (cached && isFresh(cached) && !options.forceRefresh) return cached.cities;

    let pending = inFlight.get(name);
    if (!pending) {
      pending = fetchCities(name).finally(() => {
        inFlight.delete(name);
      });
      inFlight.set(name, pending);
    }

    try {
      const cities = await pending;
      writeCache(name, cities);
      return cities;
    } catch (error) {
      if (cached) return cached.cities;
      throw error;
    }
  },

  /**
   * The first `limit` cities matching `query`, for the selector's type-ahead.
   *
   * Rendering 16,000 options is what this avoids: a prefix match is ranked
   * above a mid-string one, so typing "bar" offers Barcelona before Ibarra.
   */
  filter(cities: string[], query: string, limit = 50): string[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return cities.slice(0, limit);

    const startsWith: string[] = [];
    const contains: string[] = [];

    for (const city of cities) {
      const haystack = city.toLowerCase();

      if (haystack.startsWith(wanted)) startsWith.push(city);
      else if (haystack.includes(wanted)) contains.push(city);

      if (startsWith.length >= limit) break;
    }

    return [...startsWith, ...contains].slice(0, limit);
  },

  clearCache(country?: string): void {
    if (country) {
      storageService.remove(cityListKey(country.trim()));
      return;
    }

    for (const key of storageService.cityListKeys()) storageService.remove(key);
  },
};
