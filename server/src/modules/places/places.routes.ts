import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createCache } from '../../cache';
import { badRequest } from '../../errors';
import { ERROR_CODES } from '@ai-travel/shared';
import { findDestination, getPlaceDetails, searchPlaces } from './opentripmap';
import type { Destination, OpenTripMapPlace, OpenTripMapPlaceDetails } from './opentripmap';
import { fetchMetroStations } from './overpass';
import type { MetroStation } from './overpass';

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
/*
 * Cached like the rest, and it matters more here than anywhere else in this
 * file: Overpass is volunteer-run infrastructure with no key to identify us,
 * so the difference between one query per city per day and one per planned
 * trip is the difference between polite use and abuse of it.
 */
const metros = createCache<MetroStation[]>(TTL_MS);

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

  /*
   * An empty answer is not cached, and this cache holds for a day.
   *
   * OpenTripMap answers a throttled request with `200` and an empty
   * `FeatureCollection` rather than an error, so a burst of traffic can turn
   * a city full of museums into a city with nothing in it — and storing that
   * kept it that way for twenty-four hours. It is what put a template
   * itinerary with stock photographs in front of somebody who asked for
   * Tbilisi.
   *
   * The cost of not caching it is a repeated request for the genuinely empty
   * places — a hamlet with no attractions in 60km. Those are rare, the request
   * is cheap, and being wrong about a real city for a day is not.
   */
  if (places.length > 0) searches.set(key, places);

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

const metroQuery = z.object({
  name: z.string().trim().min(1, 'Name a place to look up.'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code.')
    .optional(),
});

/**
 * Metro stations near a named city.
 *
 * Named rather than pointed at, so the client can ask the same question it
 * asks everywhere else — it has a destination, not a latitude. The geocode is
 * the one this app already uses for that (`/places/geoname`), so a city the
 * attractions list can be built for is a city this can answer for.
 *
 * **An empty list is a normal answer, not an error**, and it covers three
 * cases that are one case to the caller: a city with no metro, a city whose
 * metro is not mapped, and a lookup that failed. The planner turns the rule
 * off for all three, which is the only safe reading — see `isNearMetro`.
 */
placesRouter.get('/places/metro', async (request: Request, response: Response) => {
  const query = metroQuery.parse(request.query);
  const key = `${query.name.toLowerCase()}|${query.country ?? ''}`;

  const cached = metros.get(key);
  if (cached) {
    cacheable(response);
    return void response.json({ stations: cached });
  }

  /*
   * A destination that cannot be geocoded is an empty list rather than a 404.
   * The caller is deciding whether to apply a filter, not showing this to
   * anybody, and there is no useful difference between "we do not know where
   * that is" and "we found no stations there" at the point where the answer
   * is used.
   */
  let stations: MetroStation[] = [];

  try {
    const place = await findDestination(query.name, query.country);
    stations = await fetchMetroStations(place.lat, place.lon);
  } catch {
    stations = [];
  }

  metros.set(key, stations);

  cacheable(response);
  response.json({ stations });
});

/** Test seam: drops every cached answer. */
export function resetPlacesCache(): void {
  destinations.clear();
  searches.clear();
  details.clear();
  metros.clear();
}
