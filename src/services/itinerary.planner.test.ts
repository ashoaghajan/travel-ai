import { describe, expect, it } from 'vitest';
import type { TravelPreferences, TripBrief } from '../types/planner.types';
import type { Activity } from '../types/travel.types';
import type { ActivityCategory } from '../types/trip.types';
import {
  DEFAULT_PREFERENCES,
  distanceKm,
  formatTime,
  planItinerary,
  scoreActivity,
  travelMinutes,
} from './itinerary.planner';

/**
 * The scheduler's tests, and the reason it is worth having.
 *
 * A template engine cannot be tested for any of this: there is no question to
 * ask "does it respect the budget?" of a module that never chose an activity.
 * Everything below is a constraint somebody set and a claim that the days obey
 * it — which is the whole argument for building trips this way rather than
 * asking a model to.
 */

/** Lisbon-ish coordinates, near enough that travel time stays small. */
const CENTRE = { lat: 38.71, lng: -9.14 };

function activity(overrides: Partial<Activity> & { id: string }): Activity {
  return {
    title: `Place ${overrides.id}`,
    category: 'culture' as ActivityCategory,
    description: 'Something to do',
    price: 0,
    rating: 4,
    reviews: 100,
    image: 'image.jpg',
    coordinates: CENTRE,
    source: 'opentripmap',
    sourceUrl: 'https://example.com',
    ...overrides,
  } as Activity;
}

/** `count` places in one category, all at the same spot unless moved. */
function pool(count: number, overrides: Partial<Activity> = {}): Activity[] {
  return Array.from({ length: count }, (_, index) =>
    activity({ id: `${overrides.category ?? 'culture'}-${index}`, ...overrides }),
  );
}

function preferences(overrides: Partial<TravelPreferences> = {}): TravelPreferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

function brief(overrides: Partial<TripBrief> = {}): TripBrief {
  return {
    destination: 'Lisbon',
    startDate: '2027-06-01',
    days: 3,
    travellers: 2,
    preferences: DEFAULT_PREFERENCES,
    ...overrides,
  };
}

describe('formatTime', () => {
  it('renders minutes past midnight as HH:MM', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(9 * 60 + 30)).toBe('09:30');
    expect(formatTime(13 * 60 + 5)).toBe('13:05');
  });

  it('clamps rather than wrapping past midnight', () => {
    expect(formatTime(25 * 60)).toBe('23:59');
    expect(formatTime(-30)).toBe('00:00');
  });
});

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(CENTRE, CENTRE)).toBe(0);
  });

  it('matches a known separation', () => {
    // Lisbon to Porto is ~274 km.
    const porto = { lat: 41.15, lng: -8.61 };
    expect(distanceKm(CENTRE, porto)).toBeGreaterThan(265);
    expect(distanceKm(CENTRE, porto)).toBeLessThan(285);
  });
});

describe('travelMinutes', () => {
  it('never returns less than the minimum, however close two places are', () => {
    expect(travelMinutes(CENTRE, { lat: 38.7101, lng: -9.1401 })).toBe(10);
  });

  it('assumes a transfer when either end has no coordinates', () => {
    expect(travelMinutes(undefined, CENTRE)).toBe(20);
    expect(travelMinutes(CENTRE, undefined)).toBe(20);
  });

  it('grows with distance', () => {
    const near = travelMinutes(CENTRE, { lat: 38.73, lng: -9.14 });
    const far = travelMinutes(CENTRE, { lat: 38.9, lng: -9.14 });

    expect(far).toBeGreaterThan(near);
  });
});

describe('scoreActivity', () => {
  it('ranks a wanted category above a more notable unwanted one', () => {
    const wanted = activity({ id: 'a', category: 'nature', rating: 3 });
    const unwanted = activity({ id: 'b', category: 'culture', rating: 5 });

    const weights = { ...DEFAULT_PREFERENCES.categoryWeights, nature: 1, culture: 0.1 };

    expect(scoreActivity(wanted, preferences({ categoryWeights: weights }))).toBeGreaterThan(
      scoreActivity(unwanted, preferences({ categoryWeights: weights })),
    );
  });

  it('prefers the cheaper of two equal places, once a budget has been set', () => {
    const cheap = activity({ id: 'a', price: 10 });
    const dear = activity({ id: 'b', price: 90 });

    const settings = preferences({ maxActivityPrice: 100 });

    expect(scoreActivity(dear, settings)).toBeLessThan(scoreActivity(cheap, settings));
  });

  it('says nothing about price when no budget has been set', () => {
    const cheap = activity({ id: 'a', price: 10 });
    const dear = activity({ id: 'b', price: 90 });

    // Without a ceiling there is no scale to judge a price against — $80 is
    // nothing for a dive and a lot for a gallery.
    expect(scoreActivity(dear, preferences())).toBe(scoreActivity(cheap, preferences()));
  });

  it('leaves an unpriced place unpenalised, whatever the budget', () => {
    const unpriced = activity({ id: 'a', price: 0 });

    expect(scoreActivity(unpriced, preferences({ maxActivityPrice: 20 }))).toBe(
      scoreActivity(unpriced, preferences()),
    );
  });
});

describe('planItinerary', () => {
  it('builds one day per day asked for, dated from the start', () => {
    const days = planItinerary(brief({ days: 3 }), pool(30));

    expect(days).toHaveLength(3);
    expect(days.map((day) => day.date)).toEqual(['2027-06-01', '2027-06-02', '2027-06-03']);
    expect(days.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
    expect(days.every((day) => day.destination === 'Lisbon')).toBe(true);
  });

  it('returns nothing when the pool is empty, so the caller can fall back', () => {
    expect(planItinerary(brief(), [])).toEqual([]);
  });

  it('returns nothing when every category has been ruled out', () => {
    const none = Object.fromEntries(
      Object.keys(DEFAULT_PREFERENCES.categoryWeights).map((key) => [key, 0]),
    ) as TravelPreferences['categoryWeights'];

    expect(planItinerary(brief({ preferences: preferences({ categoryWeights: none }) }), pool(20)))
      .toEqual([]);
  });

  it('never starts anything before the reader is up', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ dayStart: '11:00', meals: { lunch: false, dinner: false } }) }),
      pool(30),
    );

    for (const day of days) {
      for (const entry of day.activities) {
        expect(entry.time >= '11:00').toBe(true);
      }
    }
  });

  it('starts nothing after the day is meant to be over', () => {
    const days = planItinerary(
      brief({
        preferences: preferences({
          dayStart: '09:00',
          dayEnd: '13:00',
          pace: 'packed',
          meals: { lunch: false, dinner: false },
        }),
      }),
      pool(40),
    );

    for (const day of days) {
      for (const entry of day.activities) {
        expect(entry.time <= '13:00').toBe(true);
      }
    }
  });

  it('gives back an empty plan when the hours are inside out', () => {
    const inverted = preferences({ dayStart: '18:00', dayEnd: '09:00' });

    expect(planItinerary(brief({ preferences: inverted }), pool(20))).toEqual([]);
  });

  it('honours the pace: a relaxed day holds fewer stops than a packed one', () => {
    const quiet = planItinerary(
      brief({ days: 1, preferences: preferences({ pace: 'relaxed', meals: { lunch: false, dinner: false } }) }),
      pool(40),
    );
    const busy = planItinerary(
      brief({ days: 1, preferences: preferences({ pace: 'packed', meals: { lunch: false, dinner: false } }) }),
      pool(40),
    );

    expect(quiet[0].activities).toHaveLength(2);
    expect(busy[0].activities).toHaveLength(5);
  });

  it('excludes anything above the per-activity ceiling', () => {
    const affordable = pool(10, { category: 'adventure' }).map((row, index) => ({
      ...row,
      id: `cheap-${index}`,
      price: 30,
    }));
    const expensive = pool(10, { category: 'adventure' }).map((row, index) => ({
      ...row,
      id: `dear-${index}`,
      price: 200,
      // More notable, so only the ceiling can keep them out.
      rating: 5,
    }));

    const days = planItinerary(
      brief({ preferences: preferences({ maxActivityPrice: 50 }) }),
      [...expensive, ...affordable],
    );

    const chosen = days.flatMap((day) => day.activities);

    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.every((entry) => (entry.priceEstimate ?? 0) <= 50)).toBe(true);
  });

  it('keeps an unpriced place, because zero means unpublished rather than free', () => {
    const days = planItinerary(
      brief({ days: 1, preferences: preferences({ maxActivityPrice: 5 }) }),
      pool(10),
    );

    expect(days[0].activities.length).toBeGreaterThan(0);
    expect(days[0].activities.every((entry) => entry.priceEstimate === undefined)).toBe(true);
  });

  it('stops adding to a day once the daily budget is spent', () => {
    const priced = pool(20, { category: 'nature' }).map((row, index) => ({
      ...row,
      id: `p-${index}`,
      price: 40,
    }));

    const days = planItinerary(
      brief({
        days: 1,
        preferences: preferences({
          pace: 'packed',
          dailyActivityBudget: 100,
          meals: { lunch: false, dinner: false },
        }),
      }),
      priced,
    );

    const spent = days[0].activities.reduce((total, entry) => total + (entry.priceEstimate ?? 0), 0);

    expect(spent).toBeLessThanOrEqual(100);
    // Three at £40 would breach it, so the packed day of five is cut to two.
    expect(days[0].activities).toHaveLength(2);
  });

  it('never repeats a place across the trip', () => {
    const days = planItinerary(brief({ days: 5 }), pool(60));
    const ids = days.flatMap((day) => day.activities.map((entry) => entry.sourceActivityId));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('runs out quietly rather than repeating when the pool is short', () => {
    const days = planItinerary(
      brief({ days: 4, preferences: preferences({ meals: { lunch: false, dinner: false } }) }),
      pool(3),
    );

    expect(days).toHaveLength(4);
    expect(days.flatMap((day) => day.activities)).toHaveLength(3);
    expect(days[3].activities).toEqual([]);
    expect(days[3].summary).toBe('A free day in Lisbon');
  });

  it('holds lunch and dinner open when they are wanted', () => {
    const food = pool(10, { category: 'food' }).map((row, index) => ({
      ...row,
      id: `food-${index}`,
      title: `Restaurant ${index}`,
    }));

    const days = planItinerary(brief({ days: 1 }), [...pool(10), ...food]);
    const meals = days[0].activities.filter((entry) => entry.category === 'food');

    expect(meals).toHaveLength(2);
    expect(meals[0].time >= '12:00' && meals[0].time <= '14:30').toBe(true);
    expect(meals[1].time >= '19:00').toBe(true);
  });

  it('never plans a dinner outside the hours anybody eats one', () => {
    // A packed day from 11:00 with long stops used to run past eleven at
    // night, and the dinner went with it — a browser found a 23:00 dinner in
    // Lisbon. Its window bounds it now, whatever the day does.
    const food = pool(10, { category: 'food' }).map((row, index) => ({
      ...row,
      id: `food-${index}`,
    }));
    const long = pool(10, { category: 'nature' }).map((row, index) => ({
      ...row,
      id: `nature-${index}`,
      rating: 5,
    }));

    const days = planItinerary(
      brief({
        days: 1,
        preferences: preferences({ dayStart: '11:00', dayEnd: '21:00', pace: 'packed' }),
      }),
      [...long, ...food],
    );

    for (const entry of days[0].activities) {
      expect(entry.time <= '21:30').toBe(true);
    }
  });

  it('waits for the evening rather than eating at the end of a short day', () => {
    const food = pool(10, { category: 'food' }).map((row, index) => ({
      ...row,
      id: `food-${index}`,
    }));

    const days = planItinerary(
      brief({
        days: 1,
        preferences: preferences({
          dayStart: '09:00',
          dayEnd: '15:00',
          pace: 'relaxed',
          meals: { lunch: false, dinner: true },
        }),
      }),
      [...pool(10), ...food],
    );

    const dinner = days[0].activities.at(-1);

    // The day is over by mid-afternoon; dinner still belongs at seven — plus
    // the walk to get there, which is why this is a window and not an instant.
    expect(dinner?.category).toBe('food');
    expect(dinner?.time ?? '').toMatch(/^19:[0-2]\d$/);
  });

  it('leaves the meal slots alone when they are not wanted', () => {
    const food = pool(10, { category: 'food' }).map((row, index) => ({
      ...row,
      id: `food-${index}`,
    }));

    const days = planItinerary(
      brief({ days: 1, preferences: preferences({ meals: { lunch: false, dinner: false } }) }),
      [...pool(10), ...food],
    );

    // Food may still be picked as a stop on its own merit; what must not
    // happen is a meal appearing in a window nobody asked to keep open.
    expect(days[0].activities.every((entry) => entry.time < '19:00')).toBe(true);
  });

  it('prefers what the reader likes over what is merely famous', () => {
    const beaches = pool(10, { category: 'nature' }).map((row, index) => ({
      ...row,
      id: `beach-${index}`,
      rating: 3,
    }));
    const museums = pool(10, { category: 'culture' }).map((row, index) => ({
      ...row,
      id: `museum-${index}`,
      rating: 5,
    }));

    const days = planItinerary(
      brief({
        days: 1,
        preferences: preferences({
          meals: { lunch: false, dinner: false },
          categoryWeights: { ...DEFAULT_PREFERENCES.categoryWeights, nature: 1, culture: 0.1 },
        }),
      }),
      [...museums, ...beaches],
    );

    expect(days[0].activities.every((entry) => entry.category === 'nature')).toBe(true);
  });

  it('keeps a day in one part of town rather than crossing it twice', () => {
    const near = pool(4, { category: 'culture' }).map((row, index) => ({
      ...row,
      id: `near-${index}`,
      coordinates: { lat: 38.71 + index * 0.002, lng: -9.14 },
      rating: 4,
    }));
    // Slightly better rated, but an hour away — the travel charge should beat
    // the quarter-point of rating it wins by.
    const far = pool(4, { category: 'culture' }).map((row, index) => ({
      ...row,
      id: `far-${index}`,
      coordinates: { lat: 38.71 + index * 0.002, lng: -9.6 },
      rating: 4.5,
    }));

    const days = planItinerary(
      brief({ days: 1, preferences: preferences({ meals: { lunch: false, dinner: false } }) }),
      [...far, ...near],
    );

    const chosen = days[0].activities.map((entry) => entry.sourceActivityId ?? '');

    // The anchor is the best place in the pool — one of the far ones — and the
    // rest of the day stays beside it.
    expect(chosen.every((id) => id.startsWith('far'))).toBe(true);
  });

  it('leaves the last day lighter than the rest', () => {
    const days = planItinerary(
      brief({ days: 3, preferences: preferences({ pace: 'packed', meals: { lunch: false, dinner: false } }) }),
      pool(40),
    );

    expect(days[2].activities.length).toBeLessThan(days[0].activities.length);
  });

  it('gives a single-day trip a full day, since nothing is leaving it', () => {
    const days = planItinerary(
      brief({ days: 1, preferences: preferences({ pace: 'balanced', meals: { lunch: false, dinner: false } }) }),
      pool(20),
    );

    expect(days[0].activities).toHaveLength(3);
  });

  it('is deterministic — the same brief and pool give the same times and places', () => {
    const rows = pool(30);

    const first = planItinerary(brief(), rows);
    const second = planItinerary(brief(), rows);

    const shape = (days: ReturnType<typeof planItinerary>) =>
      days.map((day) => day.activities.map((entry) => `${entry.time} ${entry.title}`));

    expect(shape(first)).toEqual(shape(second));
  });

  it('carries the source id and coordinates through, so a day can be mapped', () => {
    const days = planItinerary(brief({ days: 1 }), pool(10));
    const [entry] = days[0].activities;

    expect(entry.sourceActivityId).toBeTruthy();
    expect(entry.coordinates).toEqual(CENTRE);
  });

  it('describes a day by what is in it', () => {
    const days = planItinerary(
      brief({ days: 1, preferences: preferences({ pace: 'packed', meals: { lunch: false, dinner: false } }) }),
      pool(20),
    );

    expect(days[0].summary).toMatch(/ and 3 more$/);
  });
});

/**
 * The two location rules.
 *
 * Both are filters that remove places, and both are written to stop applying
 * whenever they cannot judge — a missing base, a missing station list, a place
 * with no coordinates. These are the tests of that stance, because the failure
 * it prevents is silent: a rule that excludes on an absence produces an empty
 * pool, and an empty pool is a template trip that honours no preference at all.
 */
describe('planItinerary, by distance from the base', () => {
  /** Roughly 4 km north of `CENTRE` — 0.036° of latitude is about 4 km. */
  const FAR = { lat: 38.746, lng: -9.14 };

  const near = pool(4, { category: 'culture' });
  const far = pool(4, { category: 'nature' }).map((place) => ({ ...place, coordinates: FAR }));

  function dayTitles(days: ReturnType<typeof planItinerary>): string[] {
    return days.flatMap((day) => day.activities.map((entry) => entry.title));
  }

  it('drops the places outside the radius', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 2 }) }),
      [...near, ...far],
      { base: { coordinates: CENTRE, source: 'centre' } },
    );

    const titles = dayTitles(days);

    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((title) => title.startsWith('Place culture'))).toBe(true);
  });

  it('keeps them when the radius reaches', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 10 }) }),
      far,
      { base: { coordinates: CENTRE, source: 'centre' } },
    );

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });

  /* A base that could not be resolved is not evidence that anything is far. */
  it('does nothing when no base was found', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 1 }) }),
      far,
      {},
    );

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });

  it('keeps a place the catalogue gave no point for', () => {
    const unplaced = pool(4, { category: 'culture' }).map((place) => ({
      ...place,
      coordinates: undefined,
    }));

    const days = planItinerary(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 1 }) }),
      unplaced,
      { base: { coordinates: CENTRE, source: 'centre' } },
    );

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });

  it('is off when no radius was set, however far away things are', () => {
    const days = planItinerary(brief(), far, {
      base: { coordinates: CENTRE, source: 'centre' },
    });

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });
});

describe('planItinerary, near a metro station', () => {
  /** About 300 m from `CENTRE`: inside the ten-minute walk. */
  const STATION = { lat: 38.7127, lng: -9.14 };
  /** About 4 km away: outside it. */
  const FAR_STATION = { lat: 38.746, lng: -9.14 };

  function dayTitles(days: ReturnType<typeof planItinerary>): string[] {
    return days.flatMap((day) => day.activities.map((entry) => entry.title));
  }

  it('keeps what is within walking distance of a station', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ nearMetroOnly: true }) }),
      pool(4),
      { metroStations: [STATION] },
    );

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });

  it('drops what is not', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ nearMetroOnly: true }) }),
      pool(4),
      { metroStations: [FAR_STATION] },
    );

    expect(dayTitles(days)).toEqual([]);
  });

  /*
   * The important one. An empty list is a city with no metro, a city whose
   * metro is unmapped, and a request that failed — and reading any of those as
   * "nothing here qualifies" would hand back an empty trip for a preference
   * about convenience.
   */
  it('does not apply when there are no stations to measure against', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ nearMetroOnly: true }) }),
      pool(4),
      { metroStations: [] },
    );

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });

  it('does not apply when the lookup was never made', () => {
    const days = planItinerary(
      brief({ preferences: preferences({ nearMetroOnly: true }) }),
      pool(4),
      {},
    );

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });

  it('is off unless the preference is on', () => {
    const days = planItinerary(brief(), pool(4), { metroStations: [FAR_STATION] });

    expect(dayTitles(days).length).toBeGreaterThan(0);
  });
});
