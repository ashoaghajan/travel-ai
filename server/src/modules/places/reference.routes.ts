import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createCache } from '../../cache';
import { fetchCities, fetchCountries } from './countriesnow';
import type { Country } from './countriesnow';

/**
 * `/api/reference` — the country and city lists the explorer offers.
 *
 * Unauthenticated: these are facts about the world.
 *
 * The caching here is the whole point of moving these server-side. France
 * alone returns close to 16,000 cities, and every browser used to fetch and
 * store that for itself against a quota it shares with the reader's trips.
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

referenceRouter.get('/reference/countries', async (_request: Request, response: Response) => {
  const cached = countries.get(COUNTRIES_KEY);
  if (cached) {
    cacheable(response);
    return void response.json(cached);
  }

  const found = await fetchCountries();
  countries.set(COUNTRIES_KEY, found);

  cacheable(response);
  response.json(found);
});

const countryParam = z.object({
  country: z.string().trim().min(1, 'Name a country.').max(100),
});

referenceRouter.get(
  '/reference/countries/:country/cities',
  async (request: Request, response: Response) => {
    const { country } = countryParam.parse(request.params);
    const key = country.toLowerCase();

    const cached = cities.get(key);
    if (cached) {
      cacheable(response);
      return void response.json(cached);
    }

    const found = await fetchCities(country);
    cities.set(key, found);

    cacheable(response);
    response.json(found);
  },
);

/** Test seam: drops both lists. */
export function resetReferenceCache(): void {
  countries.clear();
  cities.clear();
}
