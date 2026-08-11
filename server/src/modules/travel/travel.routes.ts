import { ERROR_CODES } from '@ai-travel/shared';
import type { ActivityResults, Flight, FlightResults, HotelResults } from '@ai-travel/shared';
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { z } from 'zod';
import { airportsByCode, airportsInCountry, searchAirports } from './airports';
import { createCache } from '../../cache';
import { toFlights } from './flights.mapper';
import { searchHotels } from './hotels';
import { isLiteApiConfigured, locateStays } from './liteapi';
import { isViatorConfigured, searchActivities } from './viator';
import type { PriceRow } from './flights.mapper';
import { isConfigured, marker, providerGet, providerNotConfigured } from './travelpayouts';

/**
 * Priced search — `STAGE_2_PLAN.md` "Reference data" endpoints.
 *
 * Unauthenticated, like the other reference routes: prices are what a visitor
 * comes to see, and requiring an account to look at a fare would be strange.
 * That makes the IP throttle below load-bearing rather than decorative — the
 * provider quota is ours to burn.
 */

export const travelRouter = Router();

const IATA = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter airport code.');

const ISO_DATE = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

const flightQuerySchema = z.object({
  from: IATA,
  to: IATA,
  departDate: ISO_DATE,
  returnDate: ISO_DATE.optional(),
  travellers: z.coerce.number().int().min(1).max(9).default(1),
});

/** How many fares a screen can usefully show. Applied to the answer. */
const RESULT_LIMIT = 20;

/**
 * How many rows to ask the provider for.
 *
 * Deliberately much larger than `RESULT_LIMIT`, and the two are separate for a
 * reason that cost a bug: this used to be the same number, so the screen's own
 * cap was being sent to a provider that sorts by price and truncates. The
 * cheapest twenty fares of a month are not a sample of its *days* — asking
 * AUH→EVN for twenty returns twelve days of September, asking for a hundred
 * returns seventeen, and among the five it was hiding was the day before the
 * one the reader asked for. A price-ranked truncation upstream was deciding
 * which dates existed down here.
 *
 * A hundred is where the answer stops changing: 300 and 1000 return exactly
 * what 100 does, because the provider holds at most one fare per day per route.
 */
const PROVIDER_LIMIT = 100;

/**
 * The month a date falls in, which is what the provider is actually asked for.
 *
 * `prices_for_dates` searches a cache of fares previously found, not live
 * inventory, and that cache almost never holds anything keyed to one specific
 * day: JFK→LHR on a named date returns nothing, while the same route by month
 * returns a dozen real fares. Asking by day therefore produces an empty screen
 * for most routes — so the requested date becomes a preference applied below
 * rather than a filter handed to the provider.
 */
function toMonth(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Whole days between two ISO dates, unsigned. */
function daysApart(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) return Number.MAX_SAFE_INTEGER;

  return Math.abs(Math.round((from - to) / 86_400_000));
}

/**
 * The provider returns the same fare more than once.
 *
 * Two identical rows — same carrier, same flight, same day, same price — are
 * one fare as far as a reader is concerned, and a list that repeats itself
 * looks broken.
 */
function dedupe(flights: Flight[]): Flight[] {
  const seen = new Set<string>();

  return flights.filter((flight) => {
    const key = [flight.airline, flight.departureDate, flight.departureTime, flight.price].join('|');
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

/**
 * Rank a month of fares against the day that was actually asked for.
 *
 * The search has to be made by month — see `toMonth` — but a month of fares
 * ordered by price reads as a jumble: the 7th, the 21st and the 10th
 * interleaved with no pattern the reader can see. So the day the reader chose
 * decides the order: fares on it first and cheapest first, then everything
 * else by how far it is from that day, ties broken by price.
 *
 * One ordered list rather than the tiers this used to use. Those *discarded*
 * every other day the moment one fare matched, so asking for the 11th when the
 * 11th flies answered with a single card and no alternatives at all — and on
 * a route where nothing flies that day, a reader who would happily take the
 * 10th could not see whether the 12th was cheaper. Ranking says the same thing
 * about relevance without throwing away the answer to the next question.
 *
 * Never empty when the provider returned anything, and never silently wrong:
 * every card shows its own date, and the screen says so when they differ.
 */
function rankAgainstDay(flights: Flight[], wanted: string): Flight[] {
  return dedupe(flights)
    .sort((a, b) => {
      const distance =
        daysApart(a.departureDate ?? '', wanted) - daysApart(b.departureDate ?? '', wanted);

      return distance !== 0 ? distance : a.price - b.price;
    })
    .slice(0, RESULT_LIMIT);
}

const flightCache = createCache<FlightResults>();

/** Testing seam — the cache outlives a request by design. */
export function resetTravelCache(): void {
  flightCache.clear();
  hotelCache.clear();
  activityCache.clear();
}

const store = new MemoryStore();

export function resetTravelRateLimit(): void {
  store.resetAll?.();
}

/**
 * Generous per address, because one reader legitimately searches several
 * routes in a sitting; strict enough that a script cannot drain the month's
 * quota in an afternoon.
 */
const searchRateLimit = rateLimit({
  store,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  handler: (_request: Request, response: Response) => {
    response.status(429).json({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many price lookups. Wait a few minutes and try again.',
        details: null,
      },
    });
  },
});

const airportQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  /** Comma-separated IATA codes, for resolving a saved search's airports. */
  codes: z.string().trim().max(200).optional(),
  /** ISO 3166-1 alpha-2 — every airport in one country, for a destination. */
  country: z.string().trim().length(2).toUpperCase().optional(),
  /** A point to order that country's airports by, nearest first. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

/**
 * The airport directory.
 *
 * Deliberately not behind the provider-token check: it is static reference
 * data, so the picker keeps working on a deployment with no Travelpayouts
 * account even though the fares below it do not.
 */
travelRouter.get('/airports', searchRateLimit, async (request, response) => {
  const query = airportQuerySchema.parse(request.query);

  if (query.codes) {
    const codes = query.codes.split(',').map((code) => code.trim()).filter(Boolean);
    response.json(await airportsByCode(codes));
    return;
  }

  if (query.country) {
    const near =
      query.lat !== undefined && query.lon !== undefined
        ? { lat: query.lat, lon: query.lon }
        : undefined;

    response.json(await airportsInCountry(query.country, near));
    return;
  }

  response.json(await searchAirports(query.q ?? '', query.limit));
});

const hotelQuerySchema = z.object({
  destination: z.string().trim().min(1).max(80),
  checkIn: ISO_DATE,
  checkOut: ISO_DATE,
  guests: z.coerce.number().int().min(1).max(12).default(2),
});

/** As many stays as a screen can usefully show. */
const HOTEL_LIMIT = 12;

const hotelCache = createCache<HotelResults>();

/**
 * Stays for a destination.
 *
 * The source is decided by the answer rather than by configuration: Amadeus
 * being wired up does not mean it had rates for *this* city, and claiming
 * `live` over a list of nulls would tell the reader prices were quoted when
 * none were. So a single quoted price makes the set `live`, and none makes it
 * `listing` — real places, priced on the partner's side. See `hotels.ts`.
 */
travelRouter.get('/hotels/search', searchRateLimit, async (request, response) => {
  const query = hotelQuerySchema.parse(request.query);

  const key = [query.destination.toLowerCase(), query.checkIn, query.checkOut, query.guests].join(
    '|',
  );

  const cached = hotelCache.get(key);
  if (cached) {
    response.json(cached);
    return;
  }

  const hotels = await searchHotels({ ...query, limit: HOTEL_LIMIT, marker: marker() });
  const priced = hotels.some((hotel) => hotel.pricePerNight !== null);

  const results: HotelResults = {
    results: hotels,
    source: priced ? 'live' : 'listing',
    quotedAt: priced ? new Date().toISOString() : null,
  };

  hotelCache.set(key, results);

  response.json(results);
});

const hotelLocateSchema = z.object({
  /** Comma-separated catalogue ids. */
  ids: z.string().trim().min(1).max(400),
});

/**
 * Where saved stays are, by catalogue id.
 *
 * Exists for the trip map. A stay saved before the catalogue's coordinates
 * were kept has no point of its own, and its name cannot be geocoded — so this
 * is the only way to place one without asking the reader to save it again.
 */
travelRouter.get('/hotels/locate', searchRateLimit, async (request, response) => {
  const query = hotelLocateSchema.parse(request.query);
  const ids = query.ids.split(',').map((id) => id.trim()).filter(Boolean);

  if (!isLiteApiConfigured() || ids.length === 0) {
    response.json({});
    return;
  }

  const points = await locateStays(ids);

  response.json(Object.fromEntries(points));
});

const activityQuerySchema = z.object({
  destination: z.string().trim().min(1).max(80),
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
});

/** As many things to do as a screen can usefully show. */
const ACTIVITY_LIMIT = 12;

const activityCache = createCache<ActivityResults>();

/**
 * Things to do, priced.
 *
 * Empty rather than an error when Viator sells nothing here, which is the
 * common case: it lists tours and tickets, not places, so a capital has
 * products and a small town may have none. The client treats an empty answer
 * as "no priced tours" and keeps showing its own OpenTripMap attractions —
 * this endpoint adds to that list rather than replacing it.
 */
travelRouter.get('/activities/search', searchRateLimit, async (request, response) => {
  const query = activityQuerySchema.parse(request.query);

  if (!isViatorConfigured()) {
    response.json({ results: [], source: 'listing', quotedAt: null } satisfies ActivityResults);
    return;
  }

  const key = [query.destination.toLowerCase(), query.from ?? '', query.to ?? ''].join('|');

  const cached = activityCache.get(key);
  if (cached) {
    response.json(cached);
    return;
  }

  const results = await searchActivities({
    destination: query.destination,
    startDate: query.from,
    endDate: query.to,
    limit: ACTIVITY_LIMIT,
  });

  const answer: ActivityResults = {
    results,
    source: results.length > 0 ? 'live' : 'listing',
    quotedAt: results.length > 0 ? new Date().toISOString() : null,
  };

  activityCache.set(key, answer);

  response.json(answer);
});

travelRouter.get('/flights/search', searchRateLimit, async (request, response) => {
  // Throwing here rather than answering an empty list: "not configured" and
  // "no fares on this route" are different answers, and the client picks a
  // different fallback for each.
  if (!isConfigured()) throw providerNotConfigured();

  const query = flightQuerySchema.parse(request.query);

  const key = [query.from, query.to, query.departDate, query.returnDate ?? '', query.travellers].join(
    '|',
  );

  const cached = flightCache.get(key);
  if (cached) {
    response.json(cached);
    return;
  }

  const rows = await providerGet<PriceRow[]>('/aviasales/v3/prices_for_dates', {
    origin: query.from,
    destination: query.to,
    // By month — see `toMonth`. The requested day is honoured by the ranking
    // below instead, because asking for it directly returns nothing.
    departure_at: toMonth(query.departDate),
    return_at: query.returnDate ? toMonth(query.returnDate) : undefined,
    one_way: query.returnDate ? 'false' : 'true',
    currency: 'usd',
    limit: PROVIDER_LIMIT,
    sorting: 'price',
  });

  const mapped = await toFlights(Array.isArray(rows) ? rows : [], marker());

  const results: FlightResults = {
    results: rankAgainstDay(mapped, query.departDate),
    source: 'live',
    quotedAt: new Date().toISOString(),
  };

  flightCache.set(key, results);

  response.json(results);
});
