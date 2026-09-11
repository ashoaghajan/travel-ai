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
import { searchStays } from './nominatim';
import type { StayCandidate } from './nominatim';

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
/*
 * Same reasoning as the metro cache, and the same provider terms: Nominatim is
 * volunteer-run, keyless, and asks that it not be hammered. A reader confirming
 * one hotel should cost one lookup for everybody who asks about it that day.
 */
const stays = createCache<StayCandidate[]>(TTL_MS);

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
   *
   * `null` is the third case and the one that must not be flattened into the
   * other two: nobody could be asked. It reaches the caller as an empty list
   * all the same — the rule fails open either way — but it is not written to
   * the cache, and it is not offered to a browser to hold.
   */
  let stations: MetroStation[] | null = null;

  try {
    const place = await findDestination(query.name, query.country);
    stations = await fetchMetroStations(place.lat, place.lon);
  } catch {
    stations = null;
  }

  /*
   * Caching a failure here would be a day of a preference silently doing
   * nothing, which is precisely what the first deploy of this did: Overpass
   * declines requests from cloud addresses, every city answered `[]`, and a
   * 24-hour cache made each of those answers permanent until a restart.
   */
  if (stations === null) {
    response.set('Cache-Control', 'no-store');
    response.json({ stations: [] });
    return;
  }

  metros.set(key, stations);

  cacheable(response);
  response.json({ stations });
});

const stayQuery = z.object({
  q: z.string().trim().min(1, 'Name the hotel or give its address.').max(200),
  /*
   * The city, so a hotel name can be told from the same hotel name elsewhere.
   * Optional because an address search often carries its own city, and a
   * reader who pastes a full address should not have it ignored.
   */
  near: z.string().trim().min(1).max(120).optional(),
});

/**
 * How far from the city a match may be and still be a stay in it.
 *
 * The same figure the client uses for a booked stay, and here for the same
 * reason: Nominatim answers "Grand Hotel" with a Grand Hotel, and without this
 * the one in Brighton becomes the centre of a trip to Tbilisi. Sixty
 * kilometres is wide enough for an airport hotel or a resort down the coast.
 */
const MAX_STAY_FROM_CENTRE_KM = 60;

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Straight-line, matching what the planner's own filter measures. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Hotels and addresses matching a free-text query — `GET /api/places/stay`.
 *
 * The lookup behind "which hotel are you staying at?". It answers with a list
 * rather than a best guess, because the caller's next move is to show it and
 * let somebody point at the right building: a radius drawn around the wrong
 * Grand Hotel excludes a whole city silently, and there is no later moment at
 * which that mistake becomes visible.
 *
 * Two queries, in order. The name with the city appended is the one that
 * should normally win and is what keeps a Paris hotel out of a Tokyo trip. The
 * bare query is the fallback, because a full street address already names its
 * own city and appending a second one finds nothing at all.
 *
 * **An empty list is a normal answer.** It means the name was not found, and
 * the caller's response to that is to ask for the address rather than to
 * report a failure. A lookup that could not be made answers the same way and
 * is simply not cached — see the metro route for why that distinction is kept.
 */
placesRouter.get('/places/stay', async (request: Request, response: Response) => {
  const query = stayQuery.parse(request.query);
  const key = `${query.q.toLowerCase()}|${(query.near ?? '').toLowerCase()}`;

  const cached = stays.get(key);
  if (cached) {
    cacheable(response);
    return void response.json({ candidates: cached });
  }

  const attempts = query.near ? [`${query.q}, ${query.near}`, query.q] : [query.q];

  let found: StayCandidate[] | null = null;

  for (const attempt of attempts) {
    // Sequential rather than parallel: two simultaneous requests to Nominatim
    // is precisely what its usage policy asks callers not to do, and the
    // second is only needed when the first came back empty.
    found = await searchStays(attempt);

    if (found === null) break;
    if (found.length > 0) break;
  }

  if (found === null) {
    response.set('Cache-Control', 'no-store');
    return void response.json({ candidates: [] });
  }

  /*
   * Filtered against the city the trip is to, when one was named. A result
   * sixty kilometres outside it is either a different place with the same name
   * or somewhere nobody could stay and sightsee from, and both are worse than
   * showing one option fewer.
   */
  let candidates = found;

  if (query.near) {
    const centre = await findDestination(query.near).catch(() => null);

    if (centre) {
      const middle = { lat: centre.lat, lng: centre.lon };
      candidates = found.filter(
        (candidate) => distanceKm(middle, candidate) <= MAX_STAY_FROM_CENTRE_KM,
      );
    }
  }

  stays.set(key, candidates);

  cacheable(response);
  response.json({ candidates });
});

/** Test seam: drops every cached answer. */
export function resetPlacesCache(): void {
  destinations.clear();
  searches.clear();
  details.clear();
  metros.clear();
  stays.clear();
}
