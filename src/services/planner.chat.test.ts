import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerTripBrief } from '@ai-travel/shared';
import type { PendingStay } from '../types/planner.types';
import type { Activity } from '../types/travel.types';
import { activityService } from './activity.service';
import { setAccessToken } from './http';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { PlannerError, plannerService } from './planner.service';
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

const BRIEF: PlannerTripBrief = {
  title: 'Three Days in Kyoto',
  destination: 'Kyoto',
  destinationCity: 'Kyoto',
  destinationCountry: 'Japan',
  startDate: '2027-04-02',
  days: 3,
  travellers: 2,
  flightsEstimate: 1800,
  hotelsEstimate: 420,
};

/** What the attraction catalogue answers with, so a brief can be scheduled. */
function attractions(count: number): Activity[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        id: `kyoto-${index}`,
        title: `Kyoto place ${index}`,
        category: index % 3 === 0 ? 'food' : 'culture',
        description: 'A real attraction',
        price: 0,
        rating: 4,
        reviews: 50,
        image: 'photo.jpg',
        coordinates: { lat: 35.01, lng: 135.76 },
        source: 'opentripmap',
        sourceUrl: 'https://example.com',
      }) as Activity,
  );
}

function withAttractions(rows = attractions(30)) {
  return vi.spyOn(activityService, 'getActivities').mockResolvedValue({
    activities: rows,
    hasMore: false,
    source: 'network',
    fetchedAt: '2027-04-01T00:00:00.000Z',
  });
}

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
  const asked: PendingStay[] = [];

  return {
    text,
    trips,
    /** The stay questions this turn asked, which is normally none. */
    asked,
    onText: (chunk: string) => text.push(chunk),
    onTrip: (trip: unknown) => trips.push(trip),
    onStayNeeded: (pending: PendingStay) => asked.push(pending),
    get reply() {
      return text.join('');
    },
  };
}

const ASK = [{ author: 'user' as const, content: 'plan 3 days in Kyoto' }];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAccessToken('access-token');
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

  it('schedules the model’s brief into a trip the rest of the app understands', async () => {
    withAttractions();
    fetchMock.mockResolvedValueOnce(
      sse({ type: 'brief', brief: BRIEF }, { type: 'done', stopReason: 'end_turn' }),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink);

    expect(sink.trips).toHaveLength(1);
    expect(sink.trips[0]).toMatchObject({
      title: 'Three Days in Kyoto',
      destination: 'Kyoto',
      destinationCity: 'Kyoto',
      destinationCountry: 'Japan',
      travellers: 2,
      // The model's own figures, which it is better at than the flat constant.
      flightsEstimate: 1800,
      hotelsEstimate: 420,
    });
  });

  it('builds the days from the catalogue, not from the model', async () => {
    withAttractions();
    fetchMock.mockResolvedValueOnce(
      sse({ type: 'brief', brief: BRIEF }, { type: 'done', stopReason: 'end_turn' }),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink);

    const trip = sink.trips[0] as { itinerary: { activities: { sourceActivityId?: string }[] }[] };
    const entries = trip.itinerary.flatMap((day) => day.activities);

    expect(trip.itinerary).toHaveLength(3);
    expect(entries.length).toBeGreaterThan(0);
    // Every stop traces back to a row that exists. This is the whole point of
    // the split: the model can no longer invent a museum.
    expect(entries.every((entry) => entry.sourceActivityId?.startsWith('kyoto-'))).toBe(true);
  });

  it('searches for the place the model named', async () => {
    const spy = withAttractions();
    fetchMock.mockResolvedValueOnce(
      sse({ type: 'brief', brief: BRIEF }, { type: 'done', stopReason: 'end_turn' }),
    );

    await plannerService.chat(ASK, handlers());

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ destination: 'Kyoto' }));
  });

  it('applies the account’s own preferences to a brief that overrides nothing', async () => {
    withAttractions();
    fetchMock.mockResolvedValueOnce(
      sse({ type: 'brief', brief: BRIEF }, { type: 'done', stopReason: 'end_turn' }),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink, {
      preferences: { ...DEFAULT_PREFERENCES, dayStart: '11:00' },
    });

    const trip = sink.trips[0] as { itinerary: { activities: { time: string }[] }[] };
    const times = trip.itinerary.flatMap((day) => day.activities.map((entry) => entry.time));

    expect(times.length).toBeGreaterThan(0);
    expect(times.every((time) => time >= '11:00')).toBe(true);
  });

  it('lets the conversation override one preference without disturbing the rest', async () => {
    withAttractions();
    fetchMock.mockResolvedValueOnce(
      sse(
        { type: 'brief', brief: { ...BRIEF, preferences: { pace: 'relaxed' } } },
        { type: 'done', stopReason: 'end_turn' },
      ),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink, {
      preferences: {
        ...DEFAULT_PREFERENCES,
        dayStart: '11:00',
        meals: { lunch: false, dinner: false },
      },
    });

    const trip = sink.trips[0] as { itinerary: { activities: { time: string }[] }[] };

    // The pace came from the sentence; the hours are still the account's.
    expect(trip.itinerary[0].activities).toHaveLength(2);
    expect(trip.itinerary[0].activities[0].time >= '11:00').toBe(true);
  });

  it('falls back to a template when the catalogue has nothing for the place', async () => {
    vi.spyOn(activityService, 'getActivities').mockRejectedValue(new Error('offline'));
    fetchMock.mockResolvedValueOnce(
      sse({ type: 'brief', brief: BRIEF }, { type: 'done', stopReason: 'end_turn' }),
    );

    const sink = handlers();
    await plannerService.chat(ASK, sink);

    // A trip regardless — the same degradation the free tier has. Losing the
    // card entirely because one provider is down would be the worse answer.
    const trip = sink.trips[0] as { itinerary: unknown[]; title: string };
    expect(trip.itinerary.length).toBeGreaterThan(0);
    expect(trip.title).toBe('Three Days in Kyoto');
  });

  it('lands the card after the words, not in the middle of them', async () => {
    withAttractions();
    fetchMock.mockResolvedValueOnce(
      sse(
        { type: 'delta', text: 'Three days is right for Kyoto. ' },
        { type: 'brief', brief: BRIEF },
        { type: 'delta', text: 'I put the temples early.' },
        { type: 'done', stopReason: 'end_turn' },
      ),
    );

    const order: string[] = [];
    const sink = handlers();

    await plannerService.chat(ASK, {
      onText: (chunk) => {
        order.push('text');
        sink.onText(chunk);
      },
      onTrip: (trip) => {
        order.push('trip');
        sink.onTrip(trip);
      },
      onStayNeeded: sink.onStayNeeded,
    });

    // Fetching the attraction pool must not hold back the sentence somebody is
    // already reading.
    expect(order).toEqual(['text', 'text', 'trip']);
    expect(sink.reply).toBe('Three days is right for Kyoto. I put the temples early.');
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
