import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedItinerary } from '../types/planner.types';
import type { TripDraft } from '../types/trip.types';
import { plannerService } from './planner.service';

/**
 * Generation is deliberately delayed so the UI exercises its loading state;
 * fake timers skip that without weakening the assertions.
 */
const TODAY = new Date('2026-07-28T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Generates for a prompt that asks for a trip.
 *
 * Narrowed here rather than asserted at every call site: `trip` is optional on
 * the result now that a question gets an answer and no itinerary, but every
 * prompt in this file is a planning request. See `planner.intent.test.ts` for
 * the prompts that are not.
 */
async function generate(prompt: string): Promise<GeneratedItinerary & { trip: TripDraft }> {
  const pending = plannerService.generateItinerary(prompt);
  await vi.advanceTimersByTimeAsync(2000);
  const result = await pending;

  if (!result.trip) throw new Error(`Expected a trip for "${prompt}", got: ${result.reply}`);
  return { ...result, trip: result.trip };
}

describe('generateItinerary', () => {
  it('returns a reply and a trip draft', async () => {
    const { reply, trip } = await generate('Plan a 7-day trip to Bali for a couple in June.');

    expect(reply).toBe("Sure! Here's a 7-day Bali itinerary crafted for you:");
    expect(trip.title).toBe('Bali Adventure');
  });

  it('does not resolve before the delay has elapsed', async () => {
    let settled = false;
    void plannerService.generateItinerary('3 days in Bali').then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(true);
  });
});

describe('trip length', () => {
  it.each([
    ['Plan a 7-day trip to Bali', 7],
    ['5 day trip to Lisbon', 5],
    ['I want 3 nights in Bali', 3],
    ['a weekend in Porto', 3],
    ['two weeks in New Zealand', 14],
    ['one week in Bali', 7],
    ['somewhere warm please', 5],
  ])('%s → %i days', async (prompt, days) => {
    const { trip } = await generate(prompt);
    expect(trip.itinerary).toHaveLength(days);
  });

  it('clamps absurd requests to two weeks', async () => {
    const { trip } = await generate('90 day trip to Bali');
    expect(trip.itinerary).toHaveLength(14);
  });

  it('handles a single day', async () => {
    const { trip } = await generate('1 day in Bali');
    expect(trip.itinerary).toHaveLength(1);
  });
});

describe('party size', () => {
  it.each([
    ['trip to Bali for a couple', 2],
    ['solo trip to Bali', 1],
    ['Bali trip for 3 adults', 3],
    ['family holiday to Bali', 4],
    ['Bali for 5 travellers', 5],
    ['trip to Bali', 2],
  ])('%s → %i travellers', async (prompt, travellers) => {
    const { trip } = await generate(prompt);
    expect(trip.travellers).toBe(travellers);
  });
});

describe('destination', () => {
  it('matches a known template by keyword', async () => {
    const { trip } = await generate('7 days in Ubud and Canggu');
    expect(trip.destination).toBe('Bali');
    expect(trip.title).toBe('Bali Adventure');
  });

  it('is case insensitive', async () => {
    const { trip } = await generate('7 days in BALI');
    expect(trip.destination).toBe('Bali');
  });

  it('extracts an unknown destination after "to"', async () => {
    const { trip } = await generate('5 day trip to Lisbon for 3 adults');
    expect(trip.destination).toBe('Lisbon');
    expect(trip.title).toBe('Lisbon Trip');
  });

  it('extracts an unknown destination after "in"', async () => {
    const { trip } = await generate('a long weekend in Porto');
    expect(trip.destination).toBe('Porto');
  });

  it('does not mistake a month for a destination', async () => {
    const { trip } = await generate('a week away in June');
    expect(trip.destination).not.toBe('June');
  });

  it('falls back to a neutral trip when no place is named', async () => {
    const { reply, trip } = await generate('somewhere warm please');

    expect(trip.title).toBe('Your Next Trip');
    expect(reply).toContain('tell me where');
    expect(reply).not.toContain('undefined');
  });
});

describe('dates', () => {
  it('starts in the month the prompt names', async () => {
    const { trip } = await generate('7 days in Bali in June');
    expect(trip.startDate.slice(0, 7)).toBe('2027-06');
  });

  it('rolls a passed month into next year', async () => {
    // "today" is July 2026, so May has already gone.
    const { trip } = await generate('5 days in Bali in May');
    expect(trip.startDate.startsWith('2027-05')).toBe(true);
  });

  it('defaults to a month out when no month is named', async () => {
    const { trip } = await generate('5 days in Bali');
    expect(trip.startDate).toBe('2026-08-27');
  });

  it('ends the trip on the last day', async () => {
    const { trip } = await generate('7 days in Bali in June');
    expect(trip.startDate).toBe('2027-06-01');
    expect(trip.endDate).toBe('2027-06-07');
  });

  it('gives every day a consecutive date and number', async () => {
    const { trip } = await generate('5 days in Bali in June');

    expect(trip.itinerary.map((day) => day.dayNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(trip.itinerary.map((day) => day.date)).toEqual([
      '2027-06-01',
      '2027-06-02',
      '2027-06-03',
      '2027-06-04',
      '2027-06-05',
    ]);
  });
});

describe('itinerary content', () => {
  it('ends with a departure day', async () => {
    const { trip } = await generate('7 days in Bali');
    expect(trip.itinerary.at(-1)?.destination).toBe('Departure');
  });

  it('follows the spec route for the Bali demo', async () => {
    const { trip } = await generate('7 days in Bali');

    expect(trip.itinerary.map((day) => day.destination)).toEqual([
      'Ubud',
      'Ubud',
      'Nusa Penida',
      'Uluwatu',
      'Seminyak',
      'Canggu',
      'Departure',
    ]);
  });

  it('cycles templates when the trip outlasts them', async () => {
    const { trip } = await generate('14 days in Bali');

    expect(trip.itinerary).toHaveLength(14);
    expect(trip.itinerary[6].destination).toBe('Ubud');
    expect(trip.itinerary.at(-1)?.destination).toBe('Departure');
  });

  it('names the destination on generic days', async () => {
    const { trip } = await generate('5 days in Lisbon');
    expect(trip.itinerary[0].destination).toBe('Lisbon');
  });

  it('gives each day an image and activities', async () => {
    const { trip } = await generate('7 days in Bali');

    expect(trip.itinerary.every((day) => Boolean(day.image))).toBe(true);
    expect(trip.itinerary.every((day) => day.activities.length > 0)).toBe(true);
  });

  it('gives every day and activity a unique id', async () => {
    const { trip } = await generate('7 days in Bali');

    const dayIds = trip.itinerary.map((day) => day.id);
    const activityIds = trip.itinerary.flatMap((day) => day.activities.map((a) => a.id));

    expect(new Set(dayIds).size).toBe(dayIds.length);
    expect(new Set(activityIds).size).toBe(activityIds.length);
  });
});

describe('estimates', () => {
  it('prices flights per traveller', async () => {
    const { trip } = await generate('7 days in Bali for a couple');
    expect(trip.flightsEstimate).toBe(2 * 1124);
  });

  it('bills one fewer night than days', async () => {
    const { trip } = await generate('7 days in Bali');
    expect(trip.hotelsEstimate).toBe(6 * 180);
  });

  it('scales activities by party size', async () => {
    const two = await generate('7 days in Bali for a couple');
    const four = await generate('7 days in Bali for 4 adults');

    expect(four.trip.activitiesEstimate).toBe((two.trip.activitiesEstimate ?? 0) * 2);
  });

  it('charges no nights for a single-day trip', async () => {
    const { trip } = await generate('1 day in Bali');
    expect(trip.hotelsEstimate).toBe(0);
  });
});

describe('draft identity', () => {
  it('stamps every draft with an id', async () => {
    const { trip } = await generate('7 days in Bali');
    expect(trip.draftId).toMatch(/^draft_/);
  });

  it('gives separate generations separate ids', async () => {
    const first = await generate('7 days in Bali');
    const second = await generate('7 days in Bali');

    expect(first.trip.draftId).not.toBe(second.trip.draftId);
  });
});
