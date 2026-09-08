import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createCache } from '../../cache';
import { fetchCities, fetchCountries } from './countriesnow';
import type { Country } from './countriesnow';
import { reverseGeocode } from './nominatim';
import type { ReversePlace } from './nominatim';

/**
 * `/api/reference` — the country and city lists the explorer offers.
 *
 * Unauthenticated: these are facts about the world.
 *
 * The caching here is the whole point of moving these server-side. France
 * alone returns close to 16,000 cities, and every browser used to fetch and
 * store that for itself against a quota it shares with the reader's trips.
 *
 * `/reference/location` is the same idea pointed the other way: a device
 * hands over coordinates and gets back the country and city those selectors
 * are built from. It lives here rather than beside the trip map's geocoder
 * because what it answers with is a *selection*, not a point — a country name
 * spelled the way the city endpoint above expects it.
 */

export const referenceRouter = Router();

/** Borders change on a timescale that makes a day aggressive already. */
const COUNTRIES_TTL_MS = 24 * 60 * 60 * 1000;

/** City lists move slowly too, and they are the expensive ones to refetch. */
const CITIES_TTL_MS = 24 * 60 * 60 * 1000;

const countries = createCache<Country[]>(COUNTRIES_TTL_MS);
const cities = createCache<string[]>(CITIES_TTL_MS);

const MAX_AGE_SECONDS = 24 * 60 * 60;

function cacheable(response: Response): void {
  response.set('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`);
}

const COUNTRIES_KEY = 'all';

/** The country list, from the cache where there is one. */
async function loadCountries(): Promise<Country[]> {
  const cached = countries.get(COUNTRIES_KEY);
  if (cached) return cached;

  const found = await fetchCountries();
  countries.set(COUNTRIES_KEY, found);

  return found;
}

referenceRouter.get('/reference/countries', async (_request: Request, response: Response) => {
  cacheable(response);
  response.json(await loadCountries());
});

const countryParam = z.object({
  country: z.string().trim().min(1, 'Name a country.').max(100),
});

/** One country's cities, from the cache where there is one. */
async function loadCities(country: string): Promise<string[]> {
  const key = country.toLowerCase();

  const cached = cities.get(key);
  if (cached) return cached;

  const found = await fetchCities(country);
  cities.set(key, found);

  return found;
}

referenceRouter.get(
  '/reference/countries/:country/cities',
  async (request: Request, response: Response) => {
    const { country } = countryParam.parse(request.params);

    cacheable(response);
    response.json(await loadCities(country));
  },
);

/* ------------------------------------------------------------------ where */

/**
 * Points barely move, and the town at one has not moved since it was founded
 * — so this is held for as long as the lists above.
 */
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;

const locations = createCache<DeviceLocation>(LOCATION_TTL_MS);

export type DeviceLocation = {
  /** ISO 3166-1 alpha-2, or null when the coordinate is at sea. */
  countryCode: string | null;
  /** Spelled as the country list spells it — see below. */
  countryName: string | null;
  city: string | null;
};

const coordinates = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

/**
 * Three decimal places — about 110 metres.
 *
 * Coarse enough that a reader walking around their own city keeps hitting the
 * same cache entry, and fine enough that it never merges two towns. It is also
 * the only place a precise coordinate is handled: nothing here is stored, and
 * the key is all that outlives the request.
 */
function locationKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/**
 * Case- and accent-insensitive, so "Brasov" finds "Brașov".
 *
 * Nominatim is asked for English names and CountriesNow stores local ones, so
 * the two disagree about diacritics far more often than they disagree about
 * the place.
 */
function comparable(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * Which of the geocoder's names for a point is the city the selector offers.
 *
 * The candidates are already in order, most specific first, so the naive
 * answer is the first of them — and the naive answer is what put "Al Maryah
 * Island" in the city box. OpenStreetMap tags a business district of Abu Dhabi
 * as a city, and no amount of reading the address more carefully fixes a fact
 * that is wrong in the data.
 *
 * So the city list decides — and it decides both ways. It is the list the
 * reader's own city box is backed by, which makes this more than a ranking: a
 * name it recognises is a name they could have picked from the dropdown
 * themselves, and a name it does not is a name that box cannot support, that
 * the type-ahead will not complete, and that they have no way to check. Abu
 * Dhabi is in it. Al Maryah Island is not, and so it is not an answer, not
 * even as a last resort.
 *
 * **A miss is therefore null, not a consolation prize.** A country with no
 * city is a working screen: the country selector is seated, the reader types
 * one word, and the type-ahead helps them. A precise location that is not a
 * city is a wrong one — it silently narrows the search to a business district
 * and nobody is told why the results look thin.
 *
 * The single escape is a list that could not be read. Not being *able* to
 * check is a different thing from having checked and found nothing, and only
 * the second is grounds for a veto.
 */
async function cityFor(place: ReversePlace, countryName: string | null): Promise<string | null> {
  if (place.candidates.length === 0) return null;
  // Nothing to check against — see the escape above.
  if (!countryName) return place.settlement;

  let known: Map<string, string>;

  try {
    known = new Map((await loadCities(countryName)).map((city) => [comparable(city), city]));
  } catch {
    return place.settlement;
  }

  // An empty list is a real answer for territories that genuinely have no
  // entries, and it vetoes nothing: there was never a list to be absent from.
  if (known.size === 0) return place.settlement;

  // The list's own spelling, not the geocoder's: this name goes back into the
  // city box, where the type-ahead matches against that list.
  return place.candidates.map((name) => known.get(comparable(name))).find(Boolean) ?? null;
}

/**
 * The country list's own spelling of a country, by ISO code.
 *
 * This is the load-bearing part of the endpoint. OpenStreetMap and
 * CountriesNow do not agree on names — "Türkiye" against "Turkey", "Czechia"
 * against "Czech Republic" — and the city endpoint above is keyed by *name*,
 * so handing back OSM's spelling would seat the reader in a country whose
 * cities then fail to load. Matching on the code and answering with our own
 * name is what makes the result usable as a selection rather than a label.
 *
 * OSM's name is the fallback rather than nothing: a country list that is
 * momentarily unreachable should cost the city suggestions, not the answer.
 */
async function nameForCode(code: string | null, fallback: string | null): Promise<string | null> {
  if (!code) return null;

  try {
    const found = (await loadCountries()).find((country) => country.code === code);
    return found?.name ?? fallback;
  } catch {
    return fallback;
  }
}

referenceRouter.get('/reference/location', async (request: Request, response: Response) => {
  const { lat, lon } = coordinates.parse(request.query);
  const key = locationKey(lat, lon);

  const cached = locations.get(key);
  if (cached) {
    cacheable(response);
    return void response.json(cached);
  }

  const place = await reverseGeocode(lat, lon);
  const countryName = await nameForCode(place.countryCode, place.countryName);
  const found: DeviceLocation = {
    countryCode: place.countryCode,
    countryName,
    city: await cityFor(place, countryName),
  };

  locations.set(key, found);

  cacheable(response);
  response.json(found);
});

/** Test seam: drops every list. */
export function resetReferenceCache(): void {
  countries.clear();
  cities.clear();
  locations.clear();
}
