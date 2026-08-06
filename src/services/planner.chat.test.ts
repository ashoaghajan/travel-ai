import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerItineraryPlan } from '@ai-travel/shared';
import { setAccessToken } from './http';
import { PlannerError, plannerService, toTripDraft } from './planner.service';
import { weatherService } from './weather.service';

/**
 * The planner talking to the real model, and what it does when there isn't one.
 *
 * The fallback is the interesting half. A server with no `ANTHROPIC_API_KEY`
 * must still answer — the rules engine takes over — but only ever *before* the
 * first word arrives. Once the model has started talking, quietly restarting
 * with a different answer half way through a sentence would be worse than the
 * error, so a mid-stream failure stays a failure.
 */

const PLAN: PlannerItineraryPlan = {
  title: 'Three Days in Kyoto',
  destination: 'Kyoto',
  destinationCity: 'Kyoto',
  destinationCountry: 'Japan',
  startDate: '2027-04-02',
  endDate: '2027-04-04',
  travellers: 2,
  days: [
    {
      destination: 'Higashiyama',
      summary: 'Temples at dawn',
      activities: [
        { time: '09:00', title: 'Kiyomizu-dera', description: 'Quiet early.', category: 'culture', priceEstimate: 4 },
        { time: '13:00', title: 'Nishiki lunch', description: 'Market stalls.', category: 'food', priceEstimate: 12 },
      ],
    },
    {
      destination: 'Arashiyama',
      summary: 'Bamboo and the river',
      activities: [
        { time: '08:30', title: 'Bamboo grove', description: 'Before the coaches.', category: 'nature' },
      ],
    },
    {
      destination: 'Kyoto',
      summary: 'Slow morning, then the airport',
      activities: [
        { time: '11:00', title: 'Transfer to KIX', description: 'The Haruka takes 80 minutes.', category: 'travel', priceEstimate: 25 },
      ],
    },
  ],
  flightsEstimate: 1800,
  hotelsEstimate: 420,
};

function sse(...events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function envelope(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message: 'nope', details: null } }), { status });
}

function handlers() {
  const text: string[] = [];
  const trips: unknown[] = [];

  return {
    text,
    trips,
    onText: (chunk: string) => text.push(chunk),
    onTrip: (trip: unknown) => trips.push(trip),
    get reply() {
      return text.join('');
    },
  };
}

const ASK = [{ author: 'user' as const, content: 'plan 3 days in Kyoto' }];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAccessToken('access-token');
  weatherService.clearCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chat', () => {
  it('appends every chunk in order', async () => {
    fetchMock.mockResolvedValueOnce(
      sse(
        { type: 'delta', text: 'Kyoto in ' },
        { type: 'delta', text: 'April is lovely.' },
        { type: 'done', stopReason: 'end_turn' },
      ),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink);

    expect(sink.reply).toBe('Kyoto in April is lovely.');
  });

  it('turns a plan into a draft the rest of the app understands', async () => {
    fetchMock.mockResolvedValueOnce(
      sse({ type: 'itinerary', plan: PLAN }, { type: 'done', stopReason: 'end_turn' }),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink);

    expect(sink.trips).toHaveLength(1);
    expect(sink.trips[0]).toMatchObject({ title: 'Three Days in Kyoto', destination: 'Kyoto' });
  });

  it('reports a mid-stream failure instead of silently answering differently', async () => {
    fetchMock.mockResolvedValueOnce(
      sse(
        { type: 'delta', text: 'Let me look' },
        { type: 'error', code: ERROR_CODES.INTERNAL, message: 'The planner returned an error.' },
      ),
    );

    const sink = handlers();

    await expect(plannerService.chat(ASK, sink)).rejects.toThrow(PlannerError);
    // What arrived first is still the caller's to keep.
    expect(sink.reply).toBe('Let me look');
  });

  it('does not fall back once the model has started talking', async () => {
    const getWeather = vi.spyOn(weatherService, 'getWeather');

    fetchMock.mockResolvedValueOnce(
      sse(
        { type: 'delta', text: 'It is ' },
        { type: 'error', code: ERROR_CODES.INTERNAL, message: 'gone' },
      ),
    );

    await expect(
      plannerService.chat([{ author: 'user', content: 'what is the weather in Kyoto?' }], handlers()),
    ).rejects.toThrow(PlannerError);

    expect(getWeather).not.toHaveBeenCalled();
  });
});

describe('chat, on a server with no key', () => {
  it('answers the weather itself', async () => {
    vi.spyOn(weatherService, 'getWeather').mockResolvedValue({
      place: 'Abu Dhabi',
      country: 'United Arab Emirates',
      temperature: 34,
      description: 'clear',
      high: 38,
      low: 29,
    });

    fetchMock.mockResolvedValueOnce(envelope(ERROR_CODES.PROVIDER_NOT_CONFIGURED, 503));

    const sink = handlers();
    await plannerService.chat([{ author: 'user', content: 'what is the weather in Abu Dhabi?' }], sink);

    expect(sink.reply).toContain('34°C');
    expect(sink.trips).toHaveLength(0);
  });

  it('still builds a trip from a template', async () => {
    fetchMock.mockResolvedValueOnce(envelope(ERROR_CODES.PROVIDER_NOT_CONFIGURED, 503));

    const sink = handlers();
    await plannerService.chat([{ author: 'user', content: 'Plan a 7-day trip to Bali' }], sink);

    expect(sink.trips).toHaveLength(1);
    expect(sink.reply).toContain('Bali');
  });

  it('falls back when the server cannot be reached at all', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const sink = handlers();
    await plannerService.chat([{ author: 'user', content: 'Plan a trip to Bali' }], sink);

    expect(sink.trips).toHaveLength(1);
  });

  it('does not fall back for a failure that is the server going wrong', async () => {
    fetchMock.mockResolvedValueOnce(envelope(ERROR_CODES.INTERNAL, 500));

    await expect(plannerService.chat(ASK, handlers())).rejects.toMatchObject({ status: 500 });
  });
});

describe('toTripDraft', () => {
  it('numbers and dates the days from the start, not from the model', () => {
    const draft = toTripDraft(PLAN);

    expect(draft.itinerary.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
    expect(draft.itinerary.map((day) => day.date)).toEqual(['2027-04-02', '2027-04-03', '2027-04-04']);
  });

  it('gives every day and activity an id, which the model cannot', () => {
    const draft = toTripDraft(PLAN);
    const ids = draft.itinerary.flatMap((day) => [day.id, ...day.activities.map((a) => a.id)]);

    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every day a photograph', () => {
    const draft = toTripDraft(PLAN);

    expect(draft.itinerary.every((day) => Boolean(day.image))).toBe(true);
    expect(draft.coverImage).toBeTruthy();
  });

  it('totals the activities for the whole party', () => {
    // (4 + 12 + 0 + 25) per person, two travelling.
    expect(toTripDraft(PLAN).activitiesEstimate).toBe(82);
  });

  it('trusts its own day count over an end date that disagrees', () => {
    const draft = toTripDraft({ ...PLAN, endDate: '2027-04-20' });

    expect(draft.endDate).toBe('2027-04-04');
  });

  it('keeps the model’s end date when the days do agree', () => {
    expect(toTripDraft(PLAN).endDate).toBe('2027-04-04');
  });

  it('survives an unparseable date range', () => {
    const draft = toTripDraft({ ...PLAN, startDate: '2027-04-02', endDate: 'not-a-date' });

    expect(draft.itinerary).toHaveLength(3);
  });
});
