import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedItinerary } from '../types/planner.types';
import type { TripDraft } from '../types/trip.types';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { plannerService } from './planner.service';
import { PlaceNotFoundError, weatherService } from './weather.service';

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

describe('answerLocally', () => {
  /** The handler pair the planner screen passes in, recorded. */
  function handlers() {
    return { onText: vi.fn(), onTrip: vi.fn(), onStayNeeded: vi.fn() };
  }

  async function answer(prompt: string, options?: { signal?: AbortSignal }) {
    const spy = handlers();
    const pending = plannerService.answerLocally(prompt, spy, options);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    return spy;
  }

  it('hands back the same shape as a streamed turn', async () => {
    const spy = await answer('7 days in Bali');

    // The transcript, the trip card, Save and Customise are all downstream of
    // these two calls, and none of them should be able to tell the tiers apart.
    expect(spy.onText).toHaveBeenCalledWith(expect.stringContaining('Bali'));
    expect(spy.onTrip).toHaveBeenCalledWith(expect.objectContaining({ draftId: expect.any(String) }));
  });

  it('says so without a trip when it cannot answer', async () => {
    const spy = await answer('what is the airspeed velocity of an unladen swallow');

    expect(spy.onText).toHaveBeenCalled();
    // The ceiling the free tier actually has. An empty bubble would be worse.
    expect(spy.onTrip).not.toHaveBeenCalled();
  });

  it('stays quiet when the turn was already called off', async () => {
    const spy = await answer('7 days in Bali', { signal: AbortSignal.abort() });

    // Local answers are too fast to interrupt usefully, but somebody who has
    // just pressed Stop should not be handed the reply anyway.
    expect(spy.onText).not.toHaveBeenCalled();
    expect(spy.onTrip).not.toHaveBeenCalled();
  });

  /*
   * The question that has to come before the days.
   *
   * A radius is measured from a point, and until somebody says which hotel the
   * only point this engine has is the middle of the city — so "within 2 km of
   * your hotel" quietly became "within 2 km of the town hall" for every trip
   * planned before a booking existed.
   */
  describe('when a radius is set', () => {
    const withRadius = { ...DEFAULT_PREFERENCES, maxDistanceFromHotelKm: 2 };

    it('asks which hotel instead of building the trip', async () => {
      const spy = handlers();
      const pending = plannerService.answerLocally('7 days in Bali', spy, {
        preferences: withRadius,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      expect(spy.onText).toHaveBeenCalledWith(expect.stringContaining('Bali'));
      expect(spy.onText).toHaveBeenCalledWith(expect.stringContaining('2 km'));
      expect(spy.onStayNeeded).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'name', destination: 'Bali' }),
      );
      // No trip, and that is the point: the days cannot be chosen before the
      // point they are measured from is known.
      expect(spy.onTrip).not.toHaveBeenCalled();
    });

    it('carries the whole prompt into the resume, not just the destination', async () => {
      const spy = handlers();
      const pending = plannerService.answerLocally('7 days in Bali for 4', spy, {
        preferences: withRadius,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      // Replayed in full once the stay is known, so the length and the party
      // size somebody stated are not lost to the question.
      expect(spy.onStayNeeded).toHaveBeenCalledWith(
        expect.objectContaining({ resume: { kind: 'prompt', prompt: '7 days in Bali for 4' } }),
      );
    });

    it('reuses a settled stay for a follow-up that names no city', async () => {
      const spy = handlers();
      const pending = plannerService.answerLocally('make it 5 days', spy, {
        preferences: withRadius,
        // Settled earlier in the conversation. `null` is an answer — "there
        // isn't one" — and plans from the centre.
        knownStay: { destination: 'Bali', stay: null },
      });
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      // The case the memory exists for, and the one the first version of it
      // got wrong: a refinement must not re-open a settled question.
      expect(spy.onStayNeeded).not.toHaveBeenCalled();
      expect(spy.onTrip).toHaveBeenCalled();
    });

    it('asks again for a new trip, even to the same city', async () => {
      const spy = handlers();
      const pending = plannerService.answerLocally('7 days in Bali', spy, {
        preferences: withRadius,
        knownStay: {
          destination: 'Bali',
          stay: { name: 'Hotel Bali', coordinates: { lat: -8.6, lng: 115.2 } },
        },
      });
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      // Naming a city is asking for a new trip, and a hotel given for an
      // earlier one is not an answer about this one. Going quiet here is what
      // made the planner look as though the question had stopped working.
      expect(spy.onStayNeeded).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'name', destination: 'Bali' }),
      );
      expect(spy.onTrip).not.toHaveBeenCalled();
    });

    it('asks again for a trip somewhere else', async () => {
      const spy = handlers();
      const pending = plannerService.answerLocally('7 days in Lisbon', spy, {
        preferences: withRadius,
        // A hotel in Bali is not evidence about a trip to Lisbon, and reusing
        // it would be the confirmation step's own failure from the other side.
        knownStay: { destination: 'Bali', stay: { name: 'Hotel Bali', coordinates: { lat: -8.6, lng: 115.2 } } },
      });
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      expect(spy.onStayNeeded).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'name', destination: 'Lisbon' }),
      );
      expect(spy.onTrip).not.toHaveBeenCalled();
    });

    it('does not ask a question nobody can answer', async () => {
      // `generateItinerary` answers in one shot, for a caller with no way to
      // render a follow-up. A question there would hang the trip forever.
      const pending = plannerService.generateItinerary('7 days in Bali', withRadius);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await pending;

      expect(result.pendingStay).toBeUndefined();
      expect(result.trip).toBeDefined();
    });
  });
});

describe('the ceiling a free account hits', () => {
  async function replyTo(prompt: string, via: 'local' | 'offline') {
    const onText = vi.fn();
    const pending =
      via === 'local'
        ? plannerService.answerLocally(prompt, {
            onText,
            onTrip: vi.fn(),
            onStayNeeded: vi.fn(),
          })
        : plannerService.generateItinerary(prompt).then((result) => onText(result.reply));

    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    return onText.mock.calls[0][0] as string;
  }

  const UNANSWERABLE = 'what is the airspeed velocity of an unladen swallow';

  it('offers Pro on a prompt the rule engine cannot answer', async () => {
    const reply = await replyTo(UNANSWERABLE, 'local');

    expect(reply).toMatch(/pro/i);
  });

  it('offers Pro on the dead end that is actually reached', async () => {
    // `intent.ts` is eager: this is read as a place lookup, not as `unknown`,
    // and dies as "I could not find a place called ...". Found by trying it in
    // a browser rather than by reading the classifier.
    // "climate" reads as a weather question, so this is the weather lookup's
    // dead end rather than the location one. Both carry the hint.
    vi.spyOn(weatherService, 'getWeather').mockRejectedValue(
      new PlaceNotFoundError('a cold climate'),
    );

    const reply = await replyTo('what should I pack for a cold climate?', 'local');

    expect(reply).toMatch(/could not find a place/i);
    expect(reply).toMatch(/pro/i);
  });

  it('says nothing about Pro when the weather service is merely down', async () => {
    vi.spyOn(weatherService, 'findPlace').mockRejectedValue(new Error('network'));
    vi.spyOn(weatherService, 'getWeather').mockRejectedValue(new Error('network'));

    const reply = await replyTo('where is Lisbon?', 'local');

    // An outage is not a ceiling. Selling an upgrade on somebody else's
    // downtime would be both wrong and useless — Pro would not fix it.
    expect(reply).not.toMatch(/\bpro\b/i);
  });

  it('says nothing about Pro on a prompt it can answer', async () => {
    const reply = await replyTo('7 days in Bali', 'local');

    expect(reply).not.toMatch(/\bpro\b/i);
  });

  it('does not offer Pro on the no-key fallback path', async () => {
    const reply = await replyTo(UNANSWERABLE, 'offline');

    // The same rule engine answers a Pro account on a server with no key.
    // Selling Pro to somebody who already has it would be nonsense.
    expect(reply).not.toMatch(/\bpro\b/i);
  });
});
