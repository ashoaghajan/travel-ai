import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../types/travel.types';
import { activityService } from './activity.service';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { mockAiService } from './mockAi.service';

/**
 * The two paths, and the line between them.
 *
 * What matters here is not that a trip comes back — it always did — but *which*
 * engine built it. A prompt naming a place the catalogue knows gets days made
 * of real places at the reader's own hours; everything else gets the template
 * it has always got. Both are trips, and the difference has to be observable
 * or the fallback will rot without anybody noticing.
 */

function activity(id: string): Activity {
  return {
    id,
    title: `Real Place ${id}`,
    category: 'culture',
    description: 'A real attraction',
    price: 0,
    rating: 4.2,
    reviews: 80,
    image: 'photo.jpg',
    coordinates: { lat: 38.71, lng: -9.14 },
    source: 'opentripmap',
    sourceUrl: 'https://example.com',
  } as Activity;
}

function pool(count: number): Activity[] {
  return Array.from({ length: count }, (_, index) => activity(`place-${index}`));
}

function withPool(activities: Activity[]) {
  return vi.spyOn(activityService, 'getActivities').mockResolvedValue({
    activities,
    hasMore: false,
    source: 'network',
    fetchedAt: '2027-06-01T00:00:00.000Z',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateItinerary, with attractions available', () => {
  it('builds the days from real places rather than the template', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary('Plan a 3-day trip to Lisbon');

    expect(trip?.destination).toBe('Lisbon');
    expect(trip?.itinerary).toHaveLength(3);

    const entries = trip?.itinerary.flatMap((day) => day.activities) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    // Every entry traces back to a catalogue row — a template activity has no
    // `sourceActivityId` at all.
    expect(entries.every((entry) => entry.sourceActivityId?.startsWith('place-'))).toBe(true);
  });

  it('searches for the place the prompt actually named', async () => {
    const spy = withPool(pool(20));

    await mockAiService.generateItinerary('a weekend in Porto');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ destination: 'Porto' }));
  });

  it('applies the reader’s hours to the days it builds', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary('4 days in Lisbon', {
      ...DEFAULT_PREFERENCES,
      dayStart: '11:00',
      meals: { lunch: false, dinner: false },
    });

    const times = trip?.itinerary.flatMap((day) => day.activities.map((a) => a.time)) ?? [];

    expect(times.length).toBeGreaterThan(0);
    expect(times.every((time) => time >= '11:00')).toBe(true);
  });

  it('applies the reader’s budget to the days it builds', async () => {
    withPool(pool(30).map((row, index) => ({ ...row, price: index < 15 ? 25 : 300 })));

    const { trip } = await mockAiService.generateItinerary('3 days in Lisbon', {
      ...DEFAULT_PREFERENCES,
      maxActivityPrice: 50,
    });

    const prices = trip?.itinerary.flatMap((day) =>
      day.activities.map((a) => a.priceEstimate ?? 0),
    );

    expect(prices?.length).toBeGreaterThan(0);
    expect(prices?.every((price) => price <= 50)).toBe(true);
  });

  it('prices the trip from what it actually scheduled, per traveller', async () => {
    withPool(pool(30).map((row) => ({ ...row, price: 20 })));

    const { trip } = await mockAiService.generateItinerary('3 days in Lisbon for 2 people');

    const scheduled = trip?.itinerary.flatMap((day) => day.activities) ?? [];

    expect(trip?.travellers).toBe(2);
    expect(trip?.activitiesEstimate).toBe(scheduled.length * 20 * 2);
  });
});

describe('generateItinerary, falling back', () => {
  it('uses the templates when the attraction service is unreachable', async () => {
    vi.spyOn(activityService, 'getActivities').mockRejectedValue(new Error('offline'));

    const { trip } = await mockAiService.generateItinerary('Plan a 5-day trip to Bali');

    expect(trip?.itinerary).toHaveLength(5);
    expect(trip?.itinerary[0].activities.length).toBeGreaterThan(0);
    // The template path invents nothing traceable, which is how it is told
    // apart from a scheduled trip.
    expect(
      trip?.itinerary.every((day) => day.activities.every((a) => a.sourceActivityId === undefined)),
    ).toBe(true);
  });

  it('uses the templates when the catalogue has nothing for the place', async () => {
    withPool([]);

    const { trip } = await mockAiService.generateItinerary('Plan a 4-day trip to Bali');

    expect(trip?.itinerary).toHaveLength(4);
    expect(trip?.itinerary.flatMap((day) => day.activities).length).toBeGreaterThan(0);
  });

  it('never asks the catalogue when the prompt names no place', async () => {
    const spy = withPool(pool(20));

    const { trip, reply } = await mockAiService.generateItinerary('plan me something nice');

    expect(spy).not.toHaveBeenCalled();
    expect(trip?.title).toBe('Your Next Trip');
    expect(reply).toContain("tell me where you'd like to go");
  });

  it('keeps the trip the prompt asked for, whichever engine answers', async () => {
    withPool(pool(40));
    const scheduled = await mockAiService.generateItinerary('6 days in Lisbon for 3 people');

    vi.restoreAllMocks();
    vi.spyOn(activityService, 'getActivities').mockRejectedValue(new Error('offline'));
    const templated = await mockAiService.generateItinerary('6 days in Lisbon for 3 people');

    for (const trip of [scheduled.trip, templated.trip]) {
      expect(trip?.itinerary).toHaveLength(6);
      expect(trip?.travellers).toBe(3);
      expect(trip?.startDate).toBe(trip?.itinerary[0].date);
      expect(trip?.endDate).toBe(trip?.itinerary[5].date);
    }
  });
});

/**
 * The dates the prompt actually named.
 *
 * A browser found this: "plan a new trip from 14 to 18 september in Tbilisi"
 * came back as the 1st to the 5th. The length was right by coincidence — five
 * days is both the span asked for and the default — and the week was wrong,
 * which is the worst shape for a bug to have, because nothing about the answer
 * looks uncertain.
 */
describe('generateItinerary, dates', () => {
  it('starts on the date the prompt gave, not the first of that month', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary(
      'plan a new trip from 14 to 18 september in Tbilisi',
    );

    expect(trip?.startDate.slice(5)).toBe('09-14');
    expect(trip?.endDate.slice(5)).toBe('09-18');
    expect(trip?.itinerary).toHaveLength(5);
  });

  it('dates the days from that start, in order', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary('Lisbon 14-18 September');
    const dates = trip?.itinerary.map((day) => day.date.slice(5));

    expect(dates).toEqual(['09-14', '09-15', '09-16', '09-17', '09-18']);
  });

  it('takes the length from a single date’s sentence, since it names no end', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary('a 3-day trip to Lisbon on 14 September');

    expect(trip?.startDate.slice(5)).toBe('09-14');
    expect(trip?.itinerary).toHaveLength(3);
  });

  it('lets a stated range beat a stated length when they disagree', async () => {
    withPool(pool(40));

    // The dates are the specific claim; "3-day" is the round one.
    const { trip } = await mockAiService.generateItinerary(
      'a 3-day trip to Lisbon from 14 to 18 September',
    );

    expect(trip?.itinerary).toHaveLength(5);
  });

  it('still reads a bare month as the first of it', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary('a week in Lisbon in June');

    expect(trip?.startDate.slice(5)).toBe('06-01');
  });

  it('falls back to a bookable window when no date is named', async () => {
    withPool(pool(40));

    const { trip } = await mockAiService.generateItinerary('plan 4 days in Lisbon');
    const start = new Date(`${trip?.startDate}T00:00:00`);

    expect(start.getTime()).toBeGreaterThan(Date.now());
    expect(trip?.itinerary).toHaveLength(4);
  });
});
