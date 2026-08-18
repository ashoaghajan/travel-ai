import { http } from './http';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * The list of countries the explorer offers.
 *
 * Sourced from CountriesNow, which also serves the city lists `city.service`
 * uses. That shared origin is the point: the city endpoint is keyed by country
 * *name*, so taking the names from anywhere else would mean maintaining a
 * mapping for every case the two sources spell differently ("United States" vs
 * "United States of America", "Turkey" vs "Türkiye"). One datasource, no
 * mapping.
 *
 * Fetched through our own `/api/reference/countries` rather than from the
 * provider directly. The provider is keyless and CORS-open, so this is not
 * about secrecy — it is so one server-side copy answers everyone instead of
 * every browser fetching the same list for itself.
 *
 * No React component may import this file. The localStorage cache below stays:
 * it saves a request entirely, which is still better than a fast one.
 */

/** Borders change on a timescale that makes a week aggressive already. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bump to invalidate every cached copy after a shape change. */
const CACHE_VERSION = 1;

export class CountryLookupError extends Error {
  constructor(message = 'We could not load the list of countries.') {
    super(message);
    this.name = 'CountryLookupError';
  }
}

export type Country = {
  /** Display name, and the key the city endpoint expects. */
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "ES" — what OpenTripMap disambiguates on. */
  code: string;
};

type CountriesCache = {
  version: number;
  fetchedAt: string;
  countries: Country[];
};

function readCache(): CountriesCache | null {
  const cached = storageService.get<CountriesCache | null>(STORAGE_KEYS.countries, null);

  if (
    !cached ||
    cached.version !== CACHE_VERSION ||
    !Array.isArray(cached.countries) ||
    cached.countries.length === 0
  ) {
    return null;
  }

  return cached;
}

function isFresh(cache: CountriesCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

/** Concurrent callers share one request — see `activity.service` for why. */
let inFlight: Promise<Country[]> | null = null;

async function fetchCountries(): Promise<Country[]> {
  let countries: Country[];

  try {
    countries = await http.get<Country[]>('/reference/countries');
  } catch {
    throw new CountryLookupError('Could not reach the country list.');
  }

  // An empty list is not a valid answer — the explorer cannot offer a country
  // picker with nothing in it, and a stale cached copy beats an empty one.
  if (!Array.isArray(countries) || countries.length === 0) throw new CountryLookupError();

  return countries;
}

export const countryService = {
  /**
   * Every country, alphabetically. Cached for a month; a stale copy is served
   * rather than an error if the list cannot be refreshed, because a slightly
   * old country list is still a completely usable one.
   */
  async getCountries(options: { forceRefresh?: boolean } = {}): Promise<Country[]> {
    const cached = readCache();

    if (cached && isFresh(cached) && !options.forceRefresh) return cached.countries;

    inFlight ??= fetchCountries().finally(() => {
      inFlight = null;
    });

    try {
      const countries = await inFlight;

      try {
        storageService.set(STORAGE_KEYS.countries, {
          version: CACHE_VERSION,
          fetchedAt: new Date().toISOString(),
          countries,
        } satisfies CountriesCache);
      } catch {
        // Full or blocked storage must not fail a successful fetch.
      }

      return countries;
    } catch (error) {
      if (cached) return cached.countries;
      throw error;
    }
  },

  /** The country with this ISO code, if the list knows it. */
  find(countries: Country[], code: string | null): Country | null {
    if (!code) return null;

    const wanted = code.trim().toUpperCase();
    return countries.find((country) => country.code === wanted) ?? null;
  },

  /**
   * Best match for a free-text country name — used to seed the selectors from
   * a trip, which stores a name rather than a code.
   */
  findByName(countries: Country[], name: string | null | undefined): Country | null {
    if (typeof name !== 'string') return null;

    const wanted = name.trim().toLowerCase();
    if (!wanted) return null;

    return countries.find((country) => country.name.toLowerCase() === wanted) ?? null;
  },

  clearCache(): void {
    storageService.remove(STORAGE_KEYS.countries);
  },
};
