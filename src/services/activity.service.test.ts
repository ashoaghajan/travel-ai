/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import {
  PAGE_SIZE,
  activityService,
  categoryFromKinds,
  describePlace,
  isExcluded,
  ratingFromRate,
  toActivity,
} from './activity.service';
import { openTripMapService } from './opentripmap.service';
import { OpenTripMapError } from './opentripmap.service';
import { wikimediaService } from './wikimedia.service';
import { http } from './http';

const TTL_MS = 5 * 60 * 1000;

function place(xid: string, name: string, kinds: string, overrides: Record<string, unknown> = {}) {
  return { xid, name, rate: 3, kinds, point: { lon: 115.2, lat: -8.65 }, ...overrides };
}

/** Most places have no Wikidata id, so photographs are opt-in per test. */
function stubNoPhotographs() {
  vi.spyOn(wikimediaService, 'getImages').mockResolvedValue(new Map());
}

/** Stubs a successful round of API calls, with `placesPerGroup` per category. */
function stubApi(placesPerGroup = 6) {
  vi.spyOn(openTripMapService, 'findDestination').mockResolvedValue({
    name: 'Bali',
    lat: -8.65,
    lon: 115.21667,
  });

  let group = 0;
  vi.spyOn(openTripMapService, 'searchPlaces').mockImplementation(async () => {
    const prefix = `g${group++}`;
    return Array.from({ length: placesPerGroup }, (_, index) =>
      place(`${prefix}-${index}`, `Place ${prefix}-${index}`, 'cultural'),
    );
  });

  stubNoPhotographs();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- mapping */

describe('categoryFromKinds', () => {
  it.each([
    ['foods,restaurants', 'food'],
    ['diving,sport', 'adventure'],
    ['surfing,beaches,natural', 'adventure'],
    ['beaches,natural,interesting_places', 'nature'],
    ['waterfalls,natural', 'nature'],
    ['cultural,museums', 'culture'],
    ['religion,hindu_temples,interesting_places', 'culture'],
  ])('%s → %s', (kinds, expected) => {
    expect(categoryFromKinds(kinds)).toBe(expected);
  });

  it('defaults to culture for an unknown taxonomy', () => {
    expect(categoryFromKinds('banks,shops,other')).toBe('culture');
  });

  it('defaults to culture when kinds are missing', () => {
    expect(categoryFromKinds(undefined)).toBe('culture');
    expect(categoryFromKinds('')).toBe('culture');
  });

  it('ignores case and spacing', () => {
    expect(categoryFromKinds(' Beaches , Natural ')).toBe('nature');
  });
});

describe('isExcluded', () => {
  it.each([
    ['accomodations,hostels,diving', true],
    ['banks,other', true],
    ['transport,railway_stations', true],
    ['beaches,natural', false],
    ['foods,restaurants', false],
  ])('%s → %s', (kinds, expected) => {
    expect(isExcluded(kinds)).toBe(expected);
  });

  it('keeps places with no taxonomy', () => {
    expect(isExcluded(undefined)).toBe(false);
  });
});

describe('ratingFromRate', () => {
  it.each([
    [3, 5],
    [2, 3.3],
    ['3', 5],
    ['3h', 5],
    ['2h', 3.3],
  ])('%s → %s on the 5-point scale', (rate, expected) => {
    expect(ratingFromRate(rate)).toBe(expected);
  });

  it('hides a low importance score rather than showing it as a poor review', () => {
    // rate 1 means "unremarkable", not "badly reviewed" — 1.7 stars would lie.
    expect(ratingFromRate(1)).toBe(0);
    expect(ratingFromRate('1h')).toBe(0);
  });

  it('is zero when there is no signal', () => {
    expect(ratingFromRate(0)).toBe(0);
    expect(ratingFromRate(undefined)).toBe(0);
    expect(ratingFromRate('')).toBe(0);
    expect(ratingFromRate('not a number')).toBe(0);
  });

  it('never exceeds five', () => {
    expect(ratingFromRate(7)).toBe(5);
  });
});

describe('describePlace', () => {
  it('names the sharpest kinds, not the broad ones', () => {
    const description = describePlace(
      place('W1', 'Museum Bali', 'cultural,museums,interesting_places,art_galleries', {
        dist: undefined,
      }),
    );

    expect(description).toBe('Museums · Art galleries');
  });

  it('falls back to a broad kind when there is nothing sharper', () => {
    expect(describePlace(place('W2', 'Somewhere', 'cultural,interesting_places'))).toBe('Cultural');
  });

  it('drops the taxonomy’s "other_" miscellany buckets', () => {
    expect(
      describePlace(place('W2c', 'Sanur', 'beaches,other_beaches,natural', { dist: undefined })),
    ).toBe('Beaches');
  });

  it('does not pad a specific kind with the broad one above it', () => {
    expect(
      describePlace(place('W2b', 'Pura Maospait', 'religion,hindu_temples,interesting_places')),
    ).toBe('Hindu temples');
  });

  it('adds the distance from the search centre', () => {
    expect(describePlace(place('W3', 'Kuta Beach', 'beaches', { dist: 4200 }))).toBe(
      'Beaches · 4.2 km from centre',
    );
  });

  it.each([
    [120, '120 m from centre'],
    [862.12, '860 m from centre'],
    [4200, '4.2 km from centre'],
    [12400, '12 km from centre'],
  ])('%s metres → %s', (dist, expected) => {
    expect(describePlace(place('W4', 'X', 'beaches', { dist }))).toBe(`Beaches · ${expected}`);
  });

  it('omits the distance when the search did not report one', () => {
    expect(describePlace(place('W5', 'X', 'beaches', { dist: undefined }))).toBe('Beaches');
  });

  it('never ships an empty line', () => {
    expect(describePlace(place('W6', 'X', 'interesting_places', { dist: undefined }))).toBe(
      'Point of interest',
    );
    expect(describePlace(place('W7', 'X', '', { dist: undefined }))).toBe('Point of interest');
  });
});

describe('toActivity', () => {
  it('maps a search result', () => {
    const activity = toActivity(
      place('N1', 'Pura Maospait', 'religion,hindu_temples,interesting_places', { dist: 1500 }),
    );

    expect(activity).toMatchObject({
      id: 'N1',
      title: 'Pura Maospait',
      category: 'culture',
      description: 'Hindu temples · 1.5 km from centre',
      image: expect.any(String),
      rating: 5,
      reviews: 0,
      price: 0,
      coordinates: { lat: -8.65, lng: 115.2 },
    });
  });

  it('always uses a category image — search results carry no photo', () => {
    const activity = toActivity(place('N2', 'Kuta Beach', 'beaches,natural'));

    expect(activity?.image).toBeTruthy();
    expect(activity?.image).not.toContain('http');
  });

  it('drops a record with no name', () => {
    expect(toActivity(place('N6', '', 'beaches'))).toBeNull();
    expect(toActivity(place('N7', '   ', 'beaches'))).toBeNull();
  });

  it('omits coordinates when the API gives none', () => {
    expect(toActivity(place('N8', 'X', 'beaches', { point: undefined }))?.coordinates).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ cache */

describe('getActivities', () => {
  it('fetches and returns activities on a cold cache', async () => {
    stubApi();

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.source).toBe('network');
    expect(result.activities.length).toBeGreaterThan(0);
  });

  it('searches once per category so every chip has content', async () => {
    stubApi();

    await activityService.getActivities({ destination: 'Bali' });

    expect(openTripMapService.searchPlaces).toHaveBeenCalledTimes(4);
  });

  it('de-duplicates places that appear in more than one search', async () => {
    vi.spyOn(openTripMapService, 'findDestination').mockResolvedValue({
      name: 'Bali',
      lat: 0,
      lon: 0,
    });
    vi.spyOn(openTripMapService, 'searchPlaces').mockResolvedValue([
      place('shared', 'Legian Beach', 'surfing,beaches'),
    ]);
    stubNoPhotographs();

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.activities).toHaveLength(1);
  });

  it('skips hotels and other non-activities', async () => {
    vi.spyOn(openTripMapService, 'findDestination').mockResolvedValue({
      name: 'Bali',
      lat: 0,
      lon: 0,
    });
    vi.spyOn(openTripMapService, 'searchPlaces').mockResolvedValue([
      place('hotel', 'Happy Penida Hostel', 'accomodations,hostels'),
      place('dive', 'Crystal Divers', 'diving,dive_spots'),
    ]);
    stubNoPhotographs();

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.activities.map((activity) => activity.id)).toEqual(['dive']);
  });

  it('writes the result to the cache key', async () => {
    stubApi();

    await activityService.getActivities({ destination: 'Bali' });

    expect(localStorage.getItem(STORAGE_KEYS.activities)).not.toBeNull();
  });

  it('serves the second visit from the cache without calling the API', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    vi.mocked(openTripMapService.findDestination).mockClear();

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.source).toBe('cache');
    expect(openTripMapService.findDestination).not.toHaveBeenCalled();
  });

  it('still uses the cache just under five minutes', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    vi.setSystemTime(new Date(Date.now() + TTL_MS - 10_000));

    await expect(activityService.getActivities({ destination: 'Bali' })).resolves.toMatchObject({ source: 'cache' });
  });

  it('refetches once the cache is older than five minutes', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    vi.setSystemTime(new Date(Date.now() + TTL_MS + 10_000));

    await expect(activityService.getActivities({ destination: 'Bali' })).resolves.toMatchObject({ source: 'network' });
  });

  it('bypasses a fresh cache when asked to refresh', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });

    await expect(activityService.getActivities({ destination: 'Bali', forceRefresh: true })).resolves.toMatchObject({
      source: 'network',
    });
  });

  it('ignores a cache built for another destination', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });

    await expect(activityService.getActivities({ destination: 'Lisbon' })).resolves.toMatchObject({
      source: 'network',
    });
  });

  it('ignores a cache written by an older version', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    const cached = storageService.get<Record<string, unknown>>(STORAGE_KEYS.activities, {});
    storageService.set(STORAGE_KEYS.activities, { ...cached, version: 0 });

    await expect(activityService.getActivities({ destination: 'Bali' })).resolves.toMatchObject({ source: 'network' });
  });

  it('ignores a corrupt cache', async () => {
    stubApi();
    localStorage.setItem(STORAGE_KEYS.activities, 'not json');

    await expect(activityService.getActivities({ destination: 'Bali' })).resolves.toMatchObject({ source: 'network' });
  });

  it('clearCache forces the next visit back to the network', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });

    activityService.clearCache();

    await expect(activityService.getActivities({ destination: 'Bali' })).resolves.toMatchObject({ source: 'network' });
  });
});

/* ------------------------------------------------------------ photographs */

describe('bookable tours', () => {
  /** One Viator product, as `GET /api/activities/search` returns it. */
  function product(overrides: Record<string, unknown> = {}) {
    return {
      id: 'v-1',
      title: 'Sunrise trek up Mount Batur',
      description: 'A guided climb, starting at 2am.',
      price: 65,
      rating: 4.8,
      reviews: 1240,
      image: 'https://viator.example/batur.jpg',
      sourceUrl: 'https://viator.example/book/v-1',
      ...overrides,
    };
  }

  function stubTours(results: ReturnType<typeof product>[]) {
    return vi
      .spyOn(http, 'get')
      .mockResolvedValue({ results, source: 'live', quotedAt: '2026-07-28T09:00:00Z' });
  }

  it('puts priced tours above the attractions', async () => {
    stubApi();
    stubTours([product()]);

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    // A reader looking to book something finds the bookable things first.
    expect(activities[0].title).toBe('Sunrise trek up Mount Batur');
    expect(activities[0].price).toBe(65);
    expect(activities[0].sourceUrl).toBe('https://viator.example/book/v-1');
  });

  it('labels every tour as culture', async () => {
    stubApi();
    stubTours([product()]);

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    // Viator's taxonomy is hundreds of tags that do not map onto the app's six
    // categories, and guessing would mislabel things.
    expect(activities[0].category).toBe('culture');
  });

  it('gives a tour with no photograph the category artwork', async () => {
    stubApi();
    stubTours([product({ image: '' })]);

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    expect(activities[0].image).toBeTruthy();
  });

  it('drops a product with no title', async () => {
    stubApi();
    stubTours([product({ title: '   ' }), product({ id: 'v-2', title: 'Real tour' })]);

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    expect(activities.map((activity) => activity.id)).not.toContain('v-1');
    expect(activities[0].title).toBe('Real tour');
  });

  it('still lists the attractions when no tours are sold there', async () => {
    stubApi();
    stubTours([]);

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    // Viator sells tours; OpenTripMap lists monuments and parks. Neither
    // replaces the other, so a city with no products still gets its places.
    expect(activities.length).toBeGreaterThan(0);
  });

  it('still lists the attractions when the tour lookup fails', async () => {
    stubApi();
    vi.spyOn(http, 'get').mockRejectedValue(new Error('unreachable'));

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    expect(activities.length).toBeGreaterThan(0);
  });
});

describe('photographs', () => {
  /** Two places, one of which Wikidata knows a picture of. */
  function stubMixedPool() {
    vi.spyOn(openTripMapService, 'findDestination').mockResolvedValue({
      name: 'Bali',
      lat: 0,
      lon: 0,
    });
    vi.spyOn(openTripMapService, 'searchPlaces').mockResolvedValue([
      place('museum', 'Museum Bali', 'cultural,museums', { wikidata: 'Q1992789' }),
      place('warung', 'Warung Kopi', 'foods,cafes'),
    ]);
    vi.spyOn(wikimediaService, 'getImages').mockResolvedValue(
      new Map([
        [
          'Q1992789',
          {
            url: 'https://upload.example/Bali Museum.jpg',
            descriptionUrl: 'https://commons.example/File:Bali Museum.jpg',
            author: 'PHGCOM',
            license: 'CC BY-SA 3.0',
          },
        ],
      ]),
    );
  }

  it('uses the real photograph where one exists', async () => {
    stubMixedPool();

    const { activities } = await activityService.getActivities({ destination: 'Bali' });
    const museum = activities.find((activity) => activity.id === 'museum');

    expect(museum?.image).toBe('https://upload.example/Bali Museum.jpg');
  });

  it('carries the attribution the licence requires', async () => {
    stubMixedPool();

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    expect(activities.find((activity) => activity.id === 'museum')?.imageCredit).toEqual({
      author: 'PHGCOM',
      license: 'CC BY-SA 3.0',
      sourceUrl: 'https://commons.example/File:Bali Museum.jpg',
    });
  });

  it('leaves a place with no photograph on its category artwork, uncredited', async () => {
    stubMixedPool();

    const { activities } = await activityService.getActivities({ destination: 'Bali' });
    const warung = activities.find((activity) => activity.id === 'warung');

    expect(warung?.image).not.toContain('http');
    expect(warung?.imageCredit).toBeUndefined();
  });

  it('only asks about places that have a Wikidata id', async () => {
    stubMixedPool();

    await activityService.getActivities({ destination: 'Bali' });

    expect(wikimediaService.getImages).toHaveBeenCalledWith(['Q1992789']);
  });

  it('falls back to category artwork when Wikimedia is unreachable', async () => {
    stubMixedPool();
    vi.mocked(wikimediaService.getImages).mockResolvedValue(new Map());

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    expect(activities).toHaveLength(2);
    for (const activity of activities) {
      expect(activity.image).not.toContain('http');
      expect(activity.imageCredit).toBeUndefined();
    }
  });

  it('keeps the photograph in the cache, so paging does not refetch it', async () => {
    stubMixedPool();
    await activityService.getActivities({ destination: 'Bali' });
    vi.mocked(wikimediaService.getImages).mockClear();

    const { activities } = await activityService.getActivities({ destination: 'Bali' });

    expect(activities.find((activity) => activity.id === 'museum')?.image).toContain('http');
    expect(wikimediaService.getImages).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------- concurrent first loads */

describe('two callers arriving together', () => {
  it('search once, not twice', async () => {
    stubApi();

    // What StrictMode does to the page's effect in development.
    const [first, second] = await Promise.all([
      activityService.getActivities({ destination: 'Bali' }),
      activityService.getActivities({ destination: 'Bali' }),
    ]);

    expect(openTripMapService.findDestination).toHaveBeenCalledTimes(1);
    expect(openTripMapService.searchPlaces).toHaveBeenCalledTimes(4);
    expect(wikimediaService.getImages).toHaveBeenCalledTimes(1);
    expect(second.activities).toEqual(first.activities);
  });

  it('both see the failure when the shared search fails', async () => {
    vi.spyOn(openTripMapService, 'findDestination').mockRejectedValue(
      new OpenTripMapError('Could not reach OpenTripMap.'),
    );

    const results = await Promise.allSettled([
      activityService.getActivities({ destination: 'Bali' }),
      activityService.getActivities({ destination: 'Bali' }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  });

  it('searches again once the shared one has settled', async () => {
    stubApi();
    await Promise.all([activityService.getActivities({ destination: 'Bali' }), activityService.getActivities({ destination: 'Bali' })]);
    activityService.clearCache();

    await activityService.getActivities({ destination: 'Bali' });

    expect(openTripMapService.findDestination).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce across destinations', async () => {
    stubApi();

    await Promise.all([
      activityService.getActivities({ destination: 'Bali' }),
      activityService.getActivities({ destination: 'Lisbon' }),
    ]);

    expect(openTripMapService.findDestination).toHaveBeenCalledTimes(2);
  });
});

/* ---------------------------------------------------- one request per card */

describe('request cost', () => {
  it('never asks either API about an individual place', async () => {
    stubApi(20);
    // The endpoint exists for the details screen; building a list with it is
    // what cost ten requests per page, and must not come back.
    const perPlace = vi.spyOn(openTripMapService, 'getPlaceDetails');

    await activityService.getActivities({ destination: 'Bali' });
    await activityService.getActivities({ destination: 'Bali', offset: PAGE_SIZE });

    // The whole pool for one geoname, four searches and one batched lookup.
    expect(openTripMapService.findDestination).toHaveBeenCalledTimes(1);
    expect(openTripMapService.searchPlaces).toHaveBeenCalledTimes(4);
    expect(wikimediaService.getImages).toHaveBeenCalledTimes(1);
    expect(perPlace).not.toHaveBeenCalled();
  });

  it('pages without going back to the network at all', async () => {
    stubApi(20);
    await activityService.getActivities({ destination: 'Bali' });
    vi.mocked(openTripMapService.searchPlaces).mockClear();

    const second = await activityService.getActivities({ destination: 'Bali', offset: PAGE_SIZE });

    expect(second.source).toBe('cache');
    expect(openTripMapService.searchPlaces).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------- pagination */

describe('paging through the pool', () => {
  it('returns a page at a time rather than the whole pool', async () => {
    stubApi(20); // 4 groups × 20 = 80 places

    const first = await activityService.getActivities({ destination: 'Bali' });

    expect(first.activities).toHaveLength(PAGE_SIZE);
    expect(first.hasMore).toBe(true);
  });

  it('continues where the caller left off, with no repeats', async () => {
    stubApi(20);

    const first = await activityService.getActivities({ destination: 'Bali' });
    const second = await activityService.getActivities({ destination: 'Bali', offset: first.activities.length });

    expect(second.activities).toHaveLength(PAGE_SIZE);

    const ids = [...first.activities, ...second.activities].map((activity) => activity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mixes categories across a page instead of grouping them', async () => {
    const kindsPerGroup = ['beaches', 'diving', 'cultural', 'foods'];
    vi.spyOn(openTripMapService, 'findDestination').mockResolvedValue({
      name: 'Bali',
      lat: 0,
      lon: 0,
    });

    let group = 0;
    vi.spyOn(openTripMapService, 'searchPlaces').mockImplementation(async () => {
      const kinds = kindsPerGroup[group++] as string;
      return Array.from({ length: 10 }, (_, index) =>
        place(`${kinds}-${index}`, `${kinds} ${index}`, kinds),
      );
    });
    stubNoPhotographs();

    const first = await activityService.getActivities({ destination: 'Bali' });

    expect(new Set(first.activities.map((activity) => activity.category))).toEqual(
      new Set(['nature', 'adventure', 'culture', 'food']),
    );
  });

  it('reports the end of the pool on the last page', async () => {
    stubApi(3); // 12 places → two pages

    const first = await activityService.getActivities({ destination: 'Bali' });
    const second = await activityService.getActivities({ destination: 'Bali', offset: first.activities.length });

    expect(second.activities).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });

  it('does not claim more when the pool fits on one page', async () => {
    stubApi(1); // 4 places

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.activities).toHaveLength(4);
    expect(result.hasMore).toBe(false);
  });

  it('returns nothing past the end of the pool', async () => {
    stubApi(1);

    const result = await activityService.getActivities({ destination: 'Bali', offset: 50 });

    expect(result.activities).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

describe('when OpenTripMap is unavailable', () => {
  it('falls back to a stale cache with a friendly warning', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    const cachedCount = (await activityService.getActivities({ destination: 'Bali' })).activities.length;

    vi.setSystemTime(new Date(Date.now() + TTL_MS + 10_000));
    vi.mocked(openTripMapService.findDestination).mockRejectedValue(
      new OpenTripMapError('Could not reach OpenTripMap.'),
    );

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.source).toBe('stale-cache');
    expect(result.activities).toHaveLength(cachedCount);
    expect(result.warning).toMatch(/last saved copy/);
  });

  it('describes an unexpected failure without leaking it to the card', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });

    vi.setSystemTime(new Date(Date.now() + TTL_MS + 10_000));
    vi.mocked(openTripMapService.findDestination).mockRejectedValue(new Error('boom'));

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.source).toBe('stale-cache');
    expect(result.warning).toBe('Could not refresh activities. Showing the last saved copy.');
  });

  it('propagates the error when there is nothing cached', async () => {
    vi.spyOn(openTripMapService, 'findDestination').mockRejectedValue(
      new OpenTripMapError('Could not reach OpenTripMap.'),
    );

    await expect(activityService.getActivities({ destination: 'Bali' })).rejects.toThrow(OpenTripMapError);
  });

  it('keeps the cached copy when a refresh returns nothing', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });

    vi.setSystemTime(new Date(Date.now() + TTL_MS + 10_000));
    vi.mocked(openTripMapService.searchPlaces).mockResolvedValue([]);

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.source).toBe('stale-cache');
    expect(result.activities.length).toBeGreaterThan(0);
  });

  it('returns an empty list when nothing is cached and the API has nothing', async () => {
    vi.spyOn(openTripMapService, 'findDestination').mockResolvedValue({
      name: 'Bali',
      lat: 0,
      lon: 0,
    });
    vi.spyOn(openTripMapService, 'searchPlaces').mockResolvedValue([]);
    stubNoPhotographs();

    const result = await activityService.getActivities({ destination: 'Bali' });

    expect(result.activities).toEqual([]);
    expect(result.source).toBe('network');
  });
});

/* ------------------------------------------------------------ one attraction */

describe('getActivityById', () => {
  function details(overrides: Record<string, unknown> = {}) {
    return {
      xid: 'N1',
      name: 'Museum Bali',
      rate: '3',
      kinds: 'cultural,museums,interesting_places',
      point: { lon: 115.2, lat: -8.65 },
      ...overrides,
    };
  }

  it('returns the attraction with its prose and address', async () => {
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockResolvedValue(
      details({
        wikipedia_extracts: { text: 'The Bali Museum is an archaeological museum.' },
        address: { road: 'Jalan Mayor Wisnu', city: 'Denpasar', country: 'Indonesia' },
        otm: 'https://opentripmap.com/en/card/N1',
      }),
    );

    const activity = await activityService.getActivityById('N1');

    expect(activity).toMatchObject({
      id: 'N1',
      title: 'Museum Bali',
      category: 'culture',
      fullDescription: 'The Bali Museum is an archaeological museum.',
      address: 'Jalan Mayor Wisnu, Denpasar, Indonesia',
      sourceUrl: 'https://opentripmap.com/en/card/N1',
      coordinates: { lat: -8.65, lng: 115.2 },
    });
  });

  it('prefers the detail photo over the pooled one', async () => {
    stubApi();
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockResolvedValue(
      details({ xid: 'g0-0', preview: { source: 'https://example.test/photo.jpg' } }),
    );
    await activityService.getActivities({ destination: 'Bali' });

    const activity = await activityService.getActivityById('g0-0');

    expect(activity?.image).toBe('https://example.test/photo.jpg');
    expect(activity?.imageCredit).toBeUndefined();
  });

  it('keeps the pooled photo and its credit when the detail has none', async () => {
    stubApi();
    vi.spyOn(wikimediaService, 'getImages').mockResolvedValue(
      new Map([
        [
          'Q1',
          {
            url: 'https://upload.example/p.jpg',
            descriptionUrl: 'https://commons.example/File:p.jpg',
            author: 'Someone',
            license: 'CC BY-SA 4.0',
          },
        ],
      ]),
    );
    vi.mocked(openTripMapService.searchPlaces).mockResolvedValue([
      place('g0-0', 'Museum Bali', 'cultural,museums', { wikidata: 'Q1' }),
    ]);
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockResolvedValue(details({ xid: 'g0-0' }));
    await activityService.getActivities({ destination: 'Bali' });

    const activity = await activityService.getActivityById('g0-0');

    expect(activity?.image).toBe('https://upload.example/p.jpg');
    expect(activity?.imageCredit?.author).toBe('Someone');
  });

  it('falls back to the pooled card when the lookup fails', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockRejectedValue(
      new OpenTripMapError('Could not reach OpenTripMap.'),
    );

    const activity = await activityService.getActivityById('g0-0');

    expect(activity?.id).toBe('g0-0');
    expect(activity?.fullDescription).toBeUndefined();
  });

  it('propagates the failure when nothing is pooled', async () => {
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockRejectedValue(
      new OpenTripMapError('Could not reach OpenTripMap.'),
    );

    await expect(activityService.getActivityById('unknown')).rejects.toThrow(OpenTripMapError);
  });

  it('returns null for a record with no name', async () => {
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockResolvedValue(details({ name: '' }));

    await expect(activityService.getActivityById('N1')).resolves.toBeNull();
  });

  it('returns null for a blank id, without asking the API', async () => {
    const spy = vi.spyOn(openTripMapService, 'getPlaceDetails');

    await expect(activityService.getActivityById('  ')).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the rating the pool already scaled when the detail has none', async () => {
    stubApi();
    await activityService.getActivities({ destination: 'Bali' });
    vi.spyOn(openTripMapService, 'getPlaceDetails').mockResolvedValue(
      details({ xid: 'g0-0', rate: undefined }),
    );

    const activity = await activityService.getActivityById('g0-0');

    // The pooled card was rate 3 → 5 stars; re-scaling would have shrunk it.
    expect(activity?.rating).toBe(5);
  });
});
