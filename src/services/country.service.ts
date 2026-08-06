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
 * Free, keyless, and CORS-open. No React component may import this file.
 *
 * API: https://countriesnow.space/api/v0.1/countries/iso
 */

const ENDPOINT = 'https://countriesnow.space/api/v0.1/countries/iso';

/** Borders change on a timescale that makes a week aggressive already. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bump to invalidate every cached copy after a shape change. */
const CACHE_VERSION = 1;

const REQUEST_TIMEOUT_MS = 10_000;

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

type IsoResponse = {
  error?: boolean;
  data?: { name?: unknown; Iso2?: unknown }[];
};

/** Locale-aware so accented names sort where a reader expects them. */
function byName(a: Country, b: Country): number {
  return a.name.localeCompare(b.name);
}

function toCountries(payload: IsoResponse | null): Country[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  const countries = rows.flatMap((row) => {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const code = typeof row?.Iso2 === 'string' ? row.Iso2.trim().toUpperCase() : '';

    // Both are load-bearing: the name keys the city lookup, the code
    // disambiguates the city for OpenTripMap. A row missing either is unusable.
    return name && code.length === 2 ? [{ name, code }] : [];
  });

  return countries.sort(byName);
}

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
  let response: Response;

  try {
    response = await fetch(ENDPOINT, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new CountryLookupError('Could not reach the country list.');
  }

  if (!response.ok) throw new CountryLookupError();

  let payload: IsoResponse;
  try {
    payload = (await response.json()) as IsoResponse;
  } catch {
    throw new CountryLookupError();
  }

  const countries = toCountries(payload);
  if (countries.length === 0) throw new CountryLookupError();

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
