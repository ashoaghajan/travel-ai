import { ERROR_CODES } from '@ai-travel/shared';
import { HttpError } from '../../errors';

/**
 * The CountriesNow client — the country and city lists the explorer offers.
 *
 * Keyless and CORS-open, so unlike OpenTripMap this did not have to move for
 * secrecy. It moved for the cache: France alone returns close to 16,000
 * cities, and every browser was fetching and re-storing that for itself
 * against a 5MB quota shared with the reader's trips. One process holding one
 * copy serves everyone.
 *
 * Both lists come from the same origin on purpose: the city endpoint is keyed
 * by country *name*, so taking the names from anywhere else would mean
 * maintaining a mapping for every case the two sources spell differently
 * ("Turkey" vs "Türkiye"). One datasource, no mapping.
 *
 * API: https://countriesnow.space/api/v0.1
 */

const BASE_URL = 'https://countriesnow.space/api/v0.1';

const REQUEST_TIMEOUT_MS = 10_000;

export type Country = {
  /** Display name, and the key the city lookup expects. */
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "ES" — what OpenTripMap disambiguates on. */
  code: string;
};

type IsoResponse = { error?: boolean; data?: { name?: unknown; Iso2?: unknown }[] };
type CitiesResponse = { error?: boolean; data?: unknown };

function unreachable(what: string): HttpError {
  return new HttpError(502, ERROR_CODES.INTERNAL, `We could not reach the ${what} list.`);
}

function unusable(what: string): HttpError {
  return new HttpError(502, ERROR_CODES.INTERNAL, `We could not load the ${what} list.`);
}

async function get<T>(path: string, what: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw unreachable(what);
  }

  if (!response.ok) throw unusable(what);

  try {
    return (await response.json()) as T;
  } catch {
    throw unusable(what);
  }
}

/** Locale-aware so accented names sort where a reader expects them. */
function byName(a: Country, b: Country): number {
  return a.name.localeCompare(b.name);
}

export async function fetchCountries(): Promise<Country[]> {
  const payload = await get<IsoResponse>('/countries/iso', 'country');
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  const countries = rows.flatMap((row) => {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const code = typeof row?.Iso2 === 'string' ? row.Iso2.trim().toUpperCase() : '';

    // Both are load-bearing: the name keys the city lookup, the code
    // disambiguates the city for OpenTripMap. A row missing either is unusable.
    return name && code.length === 2 ? [{ name, code }] : [];
  });

  // An empty list is not a valid country list — it is a provider that answered
  // with something we could not read. Cities differ; see below.
  if (countries.length === 0) throw unusable('country');

  return countries.sort(byName);
}

export async function fetchCities(country: string): Promise<string[]> {
  const payload = await get<CitiesResponse>(
    `/countries/cities/q?country=${encodeURIComponent(country)}`,
    'city',
  );

  if (payload.error === true) throw unusable('city');

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const cities = rows.flatMap((row) =>
    typeof row === 'string' && row.trim() ? [row.trim()] : [],
  );

  // The source repeats a name when two regions share it; the selector has no
  // way to tell them apart, so one entry is all it can honestly offer. An
  // empty result stands — some territories genuinely have no entries.
  return [...new Set(cities)].sort((a, b) => a.localeCompare(b));
}
