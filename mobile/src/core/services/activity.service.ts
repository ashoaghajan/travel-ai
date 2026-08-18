import type { ActivityResults } from '@ai-travel/shared';
import type { Activity } from '../types/travel.types';
import type { ActivityCategory } from '../types/trip.types';
import { CATEGORY_IMAGES } from '../assets/category-images';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { OpenTripMapError, openTripMapService } from './opentripmap.service';
import type { OpenTripMapPlace, OpenTripMapPlaceDetails } from './opentripmap.service';
import { wikimediaService } from './wikimedia.service';
import { http } from './http';

/**
 * Activities, backed by OpenTripMap.
 *
 * Owns three jobs the API client deliberately does not: deciding what to ask
 * for, mapping the response into the `Activity` model, and serving it a page
 * at a time so the explorer can grow as the reader scrolls.
 *
 * Everything comes from the four category searches plus a batched Wikimedia
 * lookup — never a request for an individual place. OpenTripMap's `/xid`
 * endpoint carries prose and a photo, but it takes one id per request and has
 * no bulk form, so a ten-card grid cost ten HTTP requests on every scroll;
 * `wikimedia.service` reaches the same photographs 50 at a time. Paging is
 * then a slice of what is already in hand.
 */

/** Activities per page — one screen of scrolling. */
export const PAGE_SIZE = 10;

/**
 * Short enough that a place added today shows up on the next visit, long
 * enough that paging through the list is not re-running the search on every
 * scroll.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Bump to invalidate every cached copy after a shape change. */
// Bumped for the priced Viator products merged in below: a cache written
// before them holds attractions only, and would look like a place with no
// tours rather than one whose list predates them.
const CACHE_VERSION = 5;

const SEARCH_RADIUS_M = 60_000;
/** Candidates pulled per group — the pool the pages are drawn from. */
const CANDIDATES_PER_GROUP = 50;

/**
 * One search per category so every chip has something to show. Ranking is by
 * OpenTripMap's `rate`, so these are the most notable places, not the nearest.
 */
const SEARCH_GROUPS: { kinds: string; minRate: number }[] = [
  { kinds: 'beaches,natural,view_points,waterfalls,nature_reserves', minRate: 2 },
  // Generic `sport`/`amusements` is excluded on purpose: near Denpasar it
  // returns football stadiums, which no one browses a travel app for.
  { kinds: 'diving,surfing,climbing,volcanoes,caves,water_parks', minRate: 1 },
  { kinds: 'cultural,historic,architecture,religion,museums', minRate: 2 },
  { kinds: 'foods', minRate: 1 },
];

/** Places that are not things to do, whatever else they are tagged as. */
const EXCLUDED_KINDS = [
  'accomodations',
  'hostels',
  'guest_houses',
  'other_hotels',
  'motels',
  'apartments',
  'banks',
  'transport',
  'shops',
  'industrial_facilities',
  'adult',
];

/**
 * Category is derived from the place's own `kinds`, checked in this order —
 * the first match wins, and anything unmatched falls back to culture.
 *
 * Order matters for places that carry several kinds: a surf beach
 * ("surfing,beaches,natural") reads as adventure rather than nature.
 */
const CATEGORY_RULES: { category: ActivityCategory; kinds: string[] }[] = [
  {
    category: 'food',
    kinds: ['foods', 'restaurants', 'cafes', 'fast_food', 'bakeries', 'bars', 'pubs', 'biergartens'],
  },
  {
    category: 'adventure',
    kinds: [
      'diving',
      'surfing',
      'climbing',
      'sport',
      'amusements',
      'water_parks',
      'aquaparks',
      'amusement_parks',
      'volcanoes',
      'caves',
      'skydiving',
    ],
  },
  {
    category: 'nature',
    kinds: [
      'beaches',
      'natural',
      'view_points',
      'waterfalls',
      'nature_reserves',
      'geological_formations',
      'mountain_peaks',
      'islands',
      'gardens_and_parks',
      'water',
    ],
  },
];

const FALLBACK_CATEGORY: ActivityCategory = 'culture';

/** Taxonomy nodes that say nothing — every place here is an "interesting place". */
const NOISE_KINDS = new Set(['interesting_places', 'tourist_facilities', 'other']);

/**
 * Broad nodes, worth showing only when nothing sharper is present: a place
 * tagged "cultural,museums" reads better as "Museums" than as "Cultural".
 */
const BROAD_KINDS = new Set([
  'cultural',
  'natural',
  'historic',
  'architecture',
  'religion',
  'foods',
  'amusements',
  'sport',
  'urban_environment',
]);

/** Kinds named in the description before it starts to read like a tag dump. */
const DESCRIBED_KINDS = 2;

type ActivitiesCache = {
  version: number;
  destination: string;
  /** ISO 3166-1 alpha-2 the search was scoped to, when one was given. */
  countryCode?: string;
  /** ISO timestamp of the search. */
  fetchedAt: string;
  /** The whole pool, in display order — pages are slices of this. */
  activities: Activity[];
};

/**
 * One attraction, with the prose and address the list endpoint cannot return.
 *
 * Everything beyond `Activity` comes from a single `/xid` lookup, which is
 * only ever made for a place the reader has actually opened.
 */
export type ActivityDetails = Activity & {
  /** The full article extract, where the place has one. */
  fullDescription?: string;
  /** Street or locality line, assembled from whatever the API returned. */
  address?: string;
  /**
   * The country the place is in, as the provider names it.
   *
   * Kept as its own field rather than left inside `address`, because it is
   * load-bearing: `trip.filters.ts` uses it to keep an attraction off a trip
   * to another country, and parsing it back out of a display string would be
   * guessing at where the commas fall.
   */
  country?: string;
};

export type ActivitiesSource = 'network' | 'cache' | 'stale-cache';

export type ActivitiesResult = {
  /** The requested page, in display order. */
  activities: Activity[];
  /** True while candidates remain — drives the scroll-triggered next page. */
  hasMore: boolean;
  source: ActivitiesSource;
  fetchedAt: string;
  /** Set when live data could not be fetched and a stale copy is being shown. */
  warning?: string;
};

/* -------------------------------------------------------------------------
 * Mapping
 * ---------------------------------------------------------------------- */

/** True for hotels, banks and the like — tagged as places, but not things to do. */
export function isExcluded(kinds: string | undefined): boolean {
  if (!kinds) return false;

  const present = new Set(kinds.split(',').map((kind) => kind.trim().toLowerCase()));
  return EXCLUDED_KINDS.some((kind) => present.has(kind));
}

/** First matching rule wins; unmatched places are cultural. */
export function categoryFromKinds(kinds: string | undefined): ActivityCategory {
  if (!kinds) return FALLBACK_CATEGORY;

  const present = new Set(kinds.split(',').map((kind) => kind.trim().toLowerCase()));

  for (const rule of CATEGORY_RULES) {
    if (rule.kinds.some((kind) => present.has(kind))) return rule.category;
  }

  return FALLBACK_CATEGORY;
}

/** Below this, OpenTripMap is saying "unremarkable", not "poorly reviewed". */
const MIN_DISPLAYABLE_RATE = 2;

/**
 * OpenTripMap scores *importance* from 0–3 (with an "h" suffix for UNESCO
 * heritage) — it has no user ratings at all. The score is normalised onto the
 * 5-point scale the card shows.
 *
 * Anything below `MIN_DISPLAYABLE_RATE` returns 0 so the card hides the row:
 * rendering "1.7 ★" next to a perfectly good warung would read as a bad
 * review, which is the opposite of what the number means.
 */
export function ratingFromRate(rate: string | number | undefined): number {
  const numeric = typeof rate === 'number' ? rate : Number.parseInt(String(rate ?? ''), 10);
  if (!Number.isFinite(numeric) || numeric < MIN_DISPLAYABLE_RATE) return 0;

  return Math.round(Math.min(numeric, 3) * (5 / 3) * 10) / 10;
}

/** "hindu_temples" → "Hindu temples". */
function readableKind(kind: string): string {
  const words = kind.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Metres from the search centre, at a precision worth reading. */
function formatDistance(metres: number): string {
  if (metres < 950) return `${Math.round(metres / 10) * 10} m from centre`;

  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km from centre`;
}

/**
 * The line under the title, built from the only descriptive fields a search
 * result carries: what the place is, and how far out it sits.
 */
export function describePlace(place: OpenTripMapPlace): string {
  const kinds = (place.kinds ?? '')
    .split(',')
    .map((kind) => kind.trim().toLowerCase())
    .filter((kind) => kind.length > 0 && !NOISE_KINDS.has(kind))
    // "other_beaches" is the taxonomy's miscellany bucket for a parent that is
    // already in the list — it only ever reads as "Beaches · Other beaches".
    .filter((kind) => !kind.startsWith('other_'));

  // A broad node only earns its place when nothing sharper is on offer:
  // "Hindu temples" alone, not "Hindu temples · Religion".
  const specific = kinds.filter((kind) => !BROAD_KINDS.has(kind));
  const chosen = specific.length > 0 ? specific.slice(0, DESCRIBED_KINDS) : kinds.slice(0, 1);

  const parts = chosen.map(readableKind);
  if (parts.length === 0) parts.push('Point of interest');

  if (typeof place.dist === 'number' && Number.isFinite(place.dist) && place.dist >= 0) {
    parts.push(formatDistance(place.dist));
  }

  return parts.join(' · ');
}

/** Maps one search result onto the Activity model, or null if unusable. */
export function toActivity(place: OpenTripMapPlace): Activity | null {
  const title = place.name?.trim();
  if (!place.xid || !title) return null;

  const category = categoryFromKinds(place.kinds);

  return {
    id: place.xid,
    title,
    category,
    description: describePlace(place),
    // OpenTripMap has no pricing; the card shows nothing when this is zero.
    price: 0,
    rating: ratingFromRate(place.rate),
    // The API carries no review counts, and inventing them would be a lie.
    reviews: 0,
    // Search results carry no photo, so every card wears its category's.
    image: CATEGORY_IMAGES[category],
    coordinates: place.point ? { lat: place.point.lat, lng: place.point.lon } : undefined,
  };
}

/* -------------------------------------------------------------------------
 * Cache
 * ---------------------------------------------------------------------- */

function readCache(destination: string, countryCode?: string): ActivitiesCache | null {
  const cached = storageService.get<ActivitiesCache | null>(STORAGE_KEYS.activities, null);

  if (
    !cached ||
    cached.version !== CACHE_VERSION ||
    cached.destination !== destination ||
    cached.countryCode !== countryCode ||
    !Array.isArray(cached.activities) ||
    cached.activities.length === 0
  ) {
    return null;
  }

  return cached;
}

function isFresh(cache: ActivitiesCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

function writeCache(cache: ActivitiesCache): void {
  try {
    storageService.set(STORAGE_KEYS.activities, cache);
  } catch {
    // A full or blocked storage must not fail a successful fetch.
  }
}

/* -------------------------------------------------------------------------
 * Fetching
 * ---------------------------------------------------------------------- */

/**
 * Flattens the per-category searches into one ordered pool.
 *
 * Round-robin rather than one group after another, so every page carries a
 * mix of categories instead of ten beaches followed by ten temples. Groups
 * overlap — a surf beach appears under both nature and adventure — so the
 * first group to claim an id keeps it.
 */
function poolPlaces(groups: OpenTripMapPlace[][]): OpenTripMapPlace[] {
  const seen = new Set<string>();
  const places: OpenTripMapPlace[] = [];
  const deepest = Math.max(0, ...groups.map((group) => group.length));

  for (let rank = 0; rank < deepest; rank += 1) {
    for (const group of groups) {
      const candidate = group[rank];
      if (!candidate) continue;
      if (seen.has(candidate.xid)) continue;
      if (isExcluded(candidate.kinds)) continue;

      seen.add(candidate.xid);
      places.push(candidate);
    }
  }

  return places;
}

/**
 * Swaps the category artwork for a photograph of the place itself, wherever
 * one exists.
 *
 * OpenTripMap's search carries no picture, but it does carry the Wikidata id
 * that leads to one, and Wikimedia answers 50 ids per request — so the whole
 * pool is covered by a bounded handful of calls, none of them per-card. A
 * place with no id, no photo, or an unreachable Wikimedia keeps the artwork it
 * was given.
 */
async function withPhotographs(
  pairs: { place: OpenTripMapPlace; activity: Activity }[],
): Promise<Activity[]> {
  const entityIds = pairs
    .map(({ place }) => place.wikidata)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const images = await wikimediaService.getImages(entityIds);
  if (images.size === 0) return pairs.map(({ activity }) => activity);

  return pairs.map(({ place, activity }) => {
    const image = place.wikidata ? images.get(place.wikidata) : undefined;
    if (!image) return activity;

    return {
      ...activity,
      image: image.url,
      imageCredit: {
        author: image.author,
        license: image.license,
        sourceUrl: image.descriptionUrl,
      },
    };
  });
}

/**
 * The whole pool: one geoname, one search per category, then the batched
 * Wikimedia lookups — never a request for an individual place.
 */
async function fetchActivities(destination: string, countryCode?: string): Promise<Activity[]> {
  const destinationPlace = await openTripMapService.findDestination(destination, countryCode);

  const groups = await Promise.all(
    SEARCH_GROUPS.map((group) =>
      openTripMapService.searchPlaces({
        lat: destinationPlace.lat,
        lon: destinationPlace.lon,
        kinds: group.kinds,
        radius: SEARCH_RADIUS_M,
        limit: CANDIDATES_PER_GROUP,
        minRate: group.minRate,
      }),
    ),
  );

  const pairs = poolPlaces(groups)
    .map((place) => ({ place, activity: toActivity(place) }))
    .filter(
      (pair): pair is { place: OpenTripMapPlace; activity: Activity } => pair.activity !== null,
    );

  return withPhotographs(pairs);
}

/**
 * Searches currently in flight, keyed by destination.
 *
 * The cache only helps callers that arrive after a search has finished. Two
 * that arrive together both miss it and both search — React's StrictMode
 * double-invoking an effect in development is the common case, but two screens
 * mounting at once would do it too. Sharing the promise makes that cost one
 * search instead of two. Entries are dropped as soon as they settle, so this
 * coalesces concurrent callers rather than caching anything.
 */
const searchesInFlight = new Map<string, Promise<Activity[]>>();

/**
 * Bookable tours for a destination, priced.
 *
 * Empty for everything that is not a clean success — no key configured, a city
 * the provider does not sell, an unreachable API. The attractions below are
 * the answer in all of those cases, which is what this list did on its own
 * until now.
 */
async function fetchPricedActivities(destination: string): Promise<Activity[]> {
  try {
    const found = await http.get<ActivityResults>('/activities/search', {
      query: { destination },
    });

    return found.results
      .filter((product) => product.title.trim())
      .map((product) => ({
        id: product.id,
        title: product.title,
        /*
         * Viator's own taxonomy is hundreds of tags that do not map onto the
         * app's six categories, and guessing would mislabel things. `culture`
         * is the honest default for a bookable tour or ticket.
         */
        category: 'culture' as const,
        description: product.description,
        price: product.price,
        rating: product.rating,
        reviews: product.reviews,
        image: product.image || CATEGORY_IMAGES.culture,
        sourceUrl: product.sourceUrl,
      }));
  } catch {
    return [];
  }
}

function fetchActivitiesOnce(destination: string, countryCode?: string): Promise<Activity[]> {
  // Two cities can share a name across countries, so the code is part of the
  // identity of a search, not decoration on it.
  const key = `${countryCode ?? ''}|${destination}`;

  const existing = searchesInFlight.get(key);
  if (existing) return existing;

  /*
   * Both sources, priced ones first.
   *
   * They answer different questions and neither replaces the other: Viator
   * sells tours and tickets and knows what they cost, OpenTripMap lists every
   * monument and park and knows what they are. A city with no Viator products
   * still gets its attractions, and a city with them gets those at the top,
   * where a reader looking to book something will find them.
   *
   * `Promise.all` rather than sequentially: neither depends on the other, and
   * waiting for the tours before starting the attractions would put the slower
   * of the two calls on top of the faster one.
   */
  const pending = Promise.all([
    fetchPricedActivities(destination),
    fetchActivities(destination, countryCode),
  ])
    .then(([priced, listed]) => {
      // A tour and the monument it visits are different rows, but two rows of
      // the same name read as a duplicate — the priced one wins.
      const seen = new Set(priced.map((activity) => activity.title.trim().toLowerCase()));

      return [
        ...priced,
        ...listed.filter((activity) => !seen.has(activity.title.trim().toLowerCase())),
      ];
    })
    .finally(() => {
      searchesInFlight.delete(key);
    });

  searchesInFlight.set(key, pending);
  return pending;
}

/** One page cut from a pool that is already in hand. */
function page(
  cache: ActivitiesCache,
  offset: number,
  limit: number,
  source: ActivitiesSource,
  warning?: string,
): ActivitiesResult {
  return {
    activities: cache.activities.slice(offset, offset + limit),
    hasMore: cache.activities.length > offset + limit,
    source,
    fetchedAt: cache.fetchedAt,
    warning,
  };
}

function staleWarning(error: unknown): string {
  return error instanceof OpenTripMapError
    ? `${error.message} Showing the last saved copy.`
    : 'Could not refresh activities. Showing the last saved copy.';
}

/* -------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------- */

export const activityService = {
  /**
   * One page of activities: cache first, network second, stale cache as a
   * safety net.
   *
   * `offset` is an index into the pool, so the caller pages simply by passing
   * the number of activities it already holds. Only the first page of a cache
   * period touches the network — the rest are slices of what that search
   * already returned.
   *
   * Stage 2 moves this behind `GET /api/activities`; the signature holds.
   */
  async getActivities(options: {
    /**
     * Required, and deliberately so — this layer has no opinion on where the
     * reader wants to go. `explore.service` owns that decision.
     */
    destination: string;
    /**
     * ISO 3166-1 alpha-2, when the caller knows it. Without it OpenTripMap
     * picks one of the places sharing the name — Barcelona, Venezuela is a
     * real answer to "Barcelona".
     */
    countryCode?: string;
    /** How many activities the caller already has. */
    offset?: number;
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<ActivitiesResult> {
    const { destination, countryCode } = options;
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit ?? PAGE_SIZE;

    const cached = readCache(destination, countryCode);

    if (cached && isFresh(cached) && !options.forceRefresh) {
      return page(cached, offset, limit, 'cache');
    }

    try {
      const activities = await fetchActivitiesOnce(destination, countryCode);

      if (activities.length === 0 && cached) {
        // An empty result is more likely a bad query than a place with nothing
        // to do — keep showing what we had.
        return page(
          cached,
          offset,
          limit,
          'stale-cache',
          `We could not refresh activities for ${destination}. Showing the last saved copy.`,
        );
      }

      const fresh: ActivitiesCache = {
        version: CACHE_VERSION,
        destination,
        countryCode,
        fetchedAt: new Date().toISOString(),
        activities,
      };
      writeCache(fresh);

      return page(fresh, offset, limit, 'network');
    } catch (error) {
      if (cached) return page(cached, offset, limit, 'stale-cache', staleWarning(error));
      throw error;
    }
  },

  /**
   * One attraction by its OpenTripMap id.
   *
   * The cached pool answers this for free — the reader almost always arrives
   * by tapping a card that is already on screen. Only a cold arrival (a shared
   * link, a reload after the cache expired) spends the single `/xid` request,
   * and that request buys prose and an address the grid never had.
   *
   * Returns null when the place is genuinely unknown, so the page can show
   * "not found" rather than an error.
   */
  async getActivityById(id: string): Promise<ActivityDetails | null> {
    const trimmed = id.trim();
    if (!trimmed) return null;

    const pooled = storageService
      .get<ActivitiesCache | null>(STORAGE_KEYS.activities, null)
      ?.activities?.find((activity) => activity.id === trimmed);

    let details: OpenTripMapPlaceDetails;
    try {
      details = await openTripMapService.getPlaceDetails(trimmed);
    } catch (error) {
      // A pooled copy is a complete card already — better than an error page.
      if (pooled) return pooled;
      throw error;
    }

    const detailed = toActivityDetails(details, pooled);
    return detailed ?? pooled ?? null;
  },

  clearCache(): void {
    storageService.remove(STORAGE_KEYS.activities);
  },
};

/** Street, suburb and town, in the order a person would read them. */
function formatAddress(address: OpenTripMapPlaceDetails['address']): string | undefined {
  const parts = [
    address?.road,
    address?.suburb,
    address?.city ?? address?.town ?? address?.village ?? address?.county,
    address?.country,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

  return parts.length > 0 ? [...new Set(parts)].join(', ') : undefined;
}

/**
 * Merges a detail record over the pooled card.
 *
 * The pooled copy wins on nothing except as a fallback: it was built from
 * search data, and every field here is better. Its image is the exception —
 * a Wikimedia photograph the pool already resolved beats no photo at all.
 */
export function toActivityDetails(
  details: OpenTripMapPlaceDetails,
  pooled?: Activity,
): ActivityDetails | null {
  const title = details.name?.trim() || pooled?.title;
  if (!details.xid || !title) return null;

  const category = details.kinds
    ? categoryFromKinds(details.kinds)
    : (pooled?.category ?? FALLBACK_CATEGORY);
  const article = details.wikipedia_extracts?.text?.trim() || details.info?.descr?.trim();
  const photo = details.preview?.source?.trim();

  return {
    id: details.xid,
    title,
    category,
    // The one-liner under the title stays the taxonomy summary; the article is
    // long-form and belongs in `fullDescription`, below the fold.
    description:
      pooled?.description ??
      describePlace({ xid: details.xid, name: title, rate: 0, kinds: details.kinds ?? '' }),
    fullDescription: article,
    address: formatAddress(details.address),
    country: details.address?.country?.trim() || undefined,
    price: 0,
    // `pooled.rating` is already on the 5-point scale — re-scaling it would
    // quietly shrink every rating that came from the pool.
    rating: details.rate === undefined ? (pooled?.rating ?? 0) : ratingFromRate(details.rate),
    reviews: 0,
    image: photo ?? pooled?.image ?? CATEGORY_IMAGES[category],
    // Only the pool's image carries a credit; a `/xid` preview has none.
    imageCredit: photo ? undefined : pooled?.imageCredit,
    coordinates: details.point
      ? { lat: details.point.lat, lng: details.point.lon }
      : pooled?.coordinates,
    sourceUrl: details.otm,
  };
}
