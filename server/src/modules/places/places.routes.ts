import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createCache } from '../../cache';
import { badRequest } from '../../errors';
import { ERROR_CODES } from '@ai-travel/shared';
import { findDestination, getPlaceDetails, searchPlaces } from './opentripmap';
import type { Destination, OpenTripMapPlace, OpenTripMapPlaceDetails } from './opentripmap';

/**
 * `/api/places` — the attractions directory, proxied.
 *
 * Unauthenticated, like the other reference routes: these are facts about the
 * world, and requiring an account to look up where Berlin is would be strange.
 *
 * The paths mirror the three provider operations rather than our domain,
 * because the mapping into `Activity` still happens in the client's
 * `activity.service.ts`. Moving that composition here is a later job; moving
 * the key is this one.
 */

export const placesRouter = Router();

/**
 * Attractions do not move.
 *
 * A day is conservative for data whose real update frequency is "when someone
 * edits OpenStreetMap". The cache exists to protect the quota, not to paper
 * over latency, so there is no reason to expire it sooner.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

const destinations = createCache<Destination>(TTL_MS);
const searches = createCache<OpenTripMapPlace[]>(TTL_MS);
const details = createCache<OpenTripMapPlaceDetails>(TTL_MS);

/** Matches the cache: a browser may hold these just as long. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

function cacheable(response: Response): void {
  response.set('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`);
}

const geonameQuery = z.object({
  name: z.string().trim().min(1, 'Name a place to look up.'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code.')
    .optional(),
});

const searchQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  kinds: z.string().trim().min(1),
  /*
   * Bounded rather than passed through: the provider charges us for the call,
   * and an unbounded radius or limit is a way to make one request expensive.
   *
   * The ceilings are set above what the app actually asks for rather than at
   * it — the explorer searches a 60km radius for 50 candidates per group
   * (`activity.service.ts:42,44`), and a cap sitting exactly on those numbers
   * would turn any future widening into a puzzling 422.
   */
  radius: z.coerce.number().int().min(1).max(100_000).default(15_000),
  limit: z.coerce.number().int().min(1).max(200).default(30),
  rate: z.coerce.number().int().min(1).max(3).default(1),
});

placesRouter.get('/places/geoname', async (request: Request, response: Response) => {
  const query = geonameQuery.parse(request.query);
  const key = `${query.name.toLowerCase()}|${query.country ?? ''}`;

  const cached = destinations.get(key);
  if (cached) {
    cacheable(response);
    return void response.json(cached);
  }

  const found = await findDestination(query.name, query.country);
  destinations.set(key, found);

  cacheable(response);
  response.json(found);
});

placesRouter.get('/places/search', async (request: Request, response: Response) => {
  const query = searchQuery.parse(request.query);
  const key = [query.lat, query.lon, query.kinds, query.radius, query.limit, query.rate].join('|');

  const cached = searches.get(key);
  if (cached) {
    cacheable(response);
    return void response.json(cached);
  }

  const places = await searchPlaces({
    lat: query.lat,
    lon: query.lon,
    kinds: query.kinds,
    radius: query.radius,
    limit: query.limit,
    minRate: query.rate,
  });

  searches.set(key, places);

  cacheable(response);
  response.json(places);
});

placesRouter.get('/places/detail/:xid', async (request: Request, response: Response) => {
  // `params` is typed as possibly-array because Express allows repeated
  // segments; a single named segment never is, so this narrows rather than checks.
  const raw = request.params.xid;
  const xid = typeof raw === 'string' ? raw.trim() : '';

  // Its own check rather than a zod schema: the id is a path segment, and a
  // blank one is a routing mistake rather than a validation failure worth a
  // field-keyed error body.
  if (!xid) throw badRequest(ERROR_CODES.VALIDATION_FAILED, 'Name a place to look up.');

  const cached = details.get(xid);
  if (cached) {
    cacheable(response);
    return void response.json(cached);
  }

  const found = await getPlaceDetails(xid);
  details.set(xid, found);

  cacheable(response);
  response.json(found);
});

/** Test seam: drops every cached answer. */
export function resetPlacesCache(): void {
  destinations.clear();
  searches.clear();
  details.clear();
}
