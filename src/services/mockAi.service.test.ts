import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../types/travel.types';
import { activityService } from './activity.service';
import * as metro from './metro.service';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { destinationNameIn, mockAiService } from './mockAi.service';

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

/**
 * The one empty result that must not become a template trip.
 *
 * The templates honour no preference at all — their times, places and prices
 * are written into `mock/destinations.ts` — so handing one to somebody who
 * asked for "within 1 km of my hotel" answers the question with a week of
 * places that are not, and does it silently. Every *other* reason the
 * scheduler comes back empty still gets a template, because a generic week
 * beats an apology when nothing was excluded on purpose.
 */
describe('a radius with nothing inside it', () => {
  /** 15 km north of the pool, which sits on Lisbon. */
  const FAR = { lat: 38.845, lng: -9.14 };

  function askingFor(kilometres: number) {
    return { ...DEFAULT_PREFERENCES, maxDistanceFromHotelKm: kilometres };
  }

  it('says so rather than answering with a template', async () => {
    withPool(pool(40));

    const answer = await mockAiService.generateItinerary(
      'Plan a 3-day trip to Lisbon',
      askingFor(1),
      { name: 'Hotel Far Away', coordinates: FAR },
    );

    expect(answer.trip).toBeUndefined();
    expect(answer.reply).toContain('1 km');
    // Names the setting, because the preference that caused this is on a
    // screen the reader is not looking at.
    expect(answer.reply).toContain('Settings → Planning');
  });

  it('names both rules when both were doing the excluding', async () => {
    withPool(pool(40));
    // Stations somewhere else entirely, so the metro rule is genuinely in
    // force and genuinely excluding — an empty list would turn it off.
    vi.spyOn(metro, 'getMetroStations').mockResolvedValue([{ lat: 38.9, lng: -9.3 }]);

    const answer = await mockAiService.generateItinerary(
      'Plan a 3-day trip to Lisbon',
      { ...askingFor(1), nearMetroOnly: true },
      { name: 'Hotel Far Away', coordinates: FAR },
    );

    // There is no way to tell from here which of the two did it, and guessing
    // would send somebody to widen the wrong setting.
    expect(answer.trip).toBeUndefined();
    expect(answer.reply).toContain('1 km');
    expect(answer.reply).toContain('metro');
  });

  it('still templates when the catalogue itself came back empty', async () => {
    withPool([]);

    const answer = await mockAiService.generateItinerary(
      'Plan a 3-day trip to Lisbon',
      askingFor(1),
      { name: 'Hotel Far Away', coordinates: FAR },
    );

    // An empty catalogue is not evidence about a radius, so this takes the
    // template path like any other empty pool.
    expect(answer.trip?.itinerary).toHaveLength(3);
  });

  it('plans as normal when the radius does reach the places', async () => {
    withPool(pool(40));

    const answer = await mockAiService.generateItinerary(
      'Plan a 3-day trip to Lisbon',
      askingFor(5),
      { name: 'Hotel Nearby', coordinates: { lat: 38.715, lng: -9.14 } },
    );

    expect(answer.trip?.itinerary).toHaveLength(3);
  });
});

/**
 * Reading the destination out of a sentence.
 *
 * The consequence of getting this wrong is not a slightly-off trip: an
 * unparsed name means no attraction search, which means the generic template
 * with stock photographs and "Your destination" on every card. A half-parsed
 * one is worse, because it looks like it worked — "Tbilisi From" was built
 * from real Tbilisi places under a heading nobody wrote.
 */
describe('destinationNameIn', () => {
  /* The three sentences that failed in the app, and how each one failed. */
  it('reads a destination announced with "into"', () => {
    // Found nothing at all: `into` was not a preposition this knew, so the
    // commonest phrasing of the request produced a template trip.
    expect(destinationNameIn('create a new trip into Tbilisi from 14 to 18 of September')).toBe(
      'Tbilisi',
    );
  });

  it('stops the name where the dates begin', () => {
    // "Tbilisi From" — a city that does not exist, searched for in earnest.
    expect(destinationNameIn('create a trip to Tbilisi from 14 to 18 of September')).toBe(
      'Tbilisi',
    );
  });

  it('walks past a "to" that introduces a verb rather than a place', () => {
    // "Go To", from matching the first "to" in the sentence and stopping.
    expect(destinationNameIn('I want to go to Tbilisi')).toBe('Tbilisi');
  });

  it('reads a destination announced with "visit"', () => {
    // `intent.ts` counts "visit" as a request to plan; the parser now agrees.
    expect(destinationNameIn('visit Tbilisi for 5 days')).toBe('Tbilisi');
    expect(destinationNameIn("I'd like to visit Rome")).toBe('Rome');
  });

  it('keeps a multi-word name whole', () => {
    expect(destinationNameIn('trip to New York for 4 people')).toBe('New York');
    expect(destinationNameIn('travel to San Sebastian on 3 March')).toBe('San Sebastian');
    expect(destinationNameIn('a trip into Rio de Janeiro')).toBe('Rio De Janeiro');
  });

  it('skips a leading article without losing the name', () => {
    expect(destinationNameIn('plan a trip to the Hague')).toBe('Hague');
  });

  it('does not mistake a month for a place', () => {
    expect(destinationNameIn('a week in Lisbon in June')).toBe('Lisbon');
    expect(destinationNameIn('go to Porto next month')).toBe('Porto');
  });

  /*
   * A prompt that is nothing but a place name.
   *
   * `intent.ts` has always called a bare city a trip request, but nothing
   * could say *which* city — so "Tbilisi" produced the generic template, and
   * the stay question went out unanchored: with no destination, the hotel
   * lookup is not bounded to a city and "Grand Hotel" matches anywhere.
   */
  describe('a prompt that is only a place name', () => {
    it('reads it as the destination', () => {
      expect(destinationNameIn('Tbilisi')).toBe('Tbilisi');
      expect(destinationNameIn('New York')).toBe('New York');
      expect(destinationNameIn('Rio de Janeiro')).toBe('Rio De Janeiro');
    });

    it('reads one with a word of politeness after it', () => {
      expect(destinationNameIn('Tbilisi please')).toBe('Tbilisi');
    });

    it('keeps real cities that sound like ordinary words', () => {
      // The reason `NOT_A_PLACE` is short and checked against a map rather
      // than filled with anything adjective-shaped.
      expect(destinationNameIn('Split')).toBe('Split');
      expect(destinationNameIn('Nice')).toBe('Nice');
      expect(destinationNameIn('Bath')).toBe('Bath');
    });

    it('refuses a vague destination, which the templates answer better', () => {
      expect(destinationNameIn('somewhere warm')).toBeNull();
      expect(destinationNameIn('anywhere cheap')).toBeNull();
      expect(destinationNameIn('the beach')).toBeNull();
    });

    /*
     * The classifier is eager — "hello", "thanks" and "ok" are all trip
     * requests to it — so without this the planner would offer to plan a trip
     * to Hello and ask which hotel somebody is staying at in it.
     */
    it('refuses conversation', () => {
      for (const said of ['hello', 'thanks', 'yes', 'ok', 'what a lovely day']) {
        expect(destinationNameIn(said)).toBeNull();
      }
    });

    it('reads one followed by dates, commas and all', () => {
      // A comma was enough to fail the word test and yield nothing at all.
      expect(destinationNameIn('Tbilisi, 14-18 September')).toBe('Tbilisi');
      expect(destinationNameIn('Tbilisi from 14 to 18 September')).toBe('Tbilisi');
      expect(destinationNameIn('Tbilisi for two people')).toBe('Tbilisi');
    });

    it('reads one behind a planning word, which is not a preposition', () => {
      expect(destinationNameIn('trip Tbilisi')).toBe('Tbilisi');
      expect(destinationNameIn('plan Tbilisi for 5 days')).toBe('Tbilisi');
    });

    it('keeps a name that begins with "new"', () => {
      // It reads like a lead-in, and skipping it turned these into York,
      // Orleans and Delhi.
      expect(destinationNameIn('New York')).toBe('New York');
      expect(destinationNameIn('New Orleans')).toBe('New Orleans');
      expect(destinationNameIn('New Delhi in March')).toBe('New Delhi');
    });

    /*
     * The bare-name fallback reads a short prompt with no preposition as a
     * place, so a short refinement is the case it most easily gets wrong —
     * and getting it wrong costs twice over: a trip to nowhere, and a settled
     * hotel question re-opened because naming a city means a new trip.
     */
    it('refuses a refinement of the trip already on screen', () => {
      for (const said of [
        'make it 5 days',
        'more food',
        'cheaper',
        'later mornings',
        'add a museum',
        'something different',
      ]) {
        expect(destinationNameIn(said)).toBeNull();
      }
    });

    it('refuses a sentence too long to be a bare name', () => {
      // No opener anywhere in it, so it is not naming a destination at all.
      expect(destinationNameIn('tell me something interesting about travel')).toBeNull();
    });
  });
});
