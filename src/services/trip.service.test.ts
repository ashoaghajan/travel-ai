import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { Trip, TripDraft } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import {
  ActivityAlreadyOnDayError,
  ItineraryDayNotFoundError,
  StaleTripError,
  TripNotFoundError,
  minutesOf,
  toItineraryActivity,
  tripService,
} from './trip.service';
import { ApiError, http } from './http';

/**
 * The trips client, now that trips live in Postgres.
 *
 * This file used to test persistence — it wrote to `localStorage` and read it
 * back. That behaviour moved to `server/src/modules/trips/`, where it is
 * tested against a real database. What is left is the contract this file keeps
 * with the rest of the app: the requests it makes, and the fact that an API
 * failure arrives as the error class six call sites branch on rather than as
 * an `ApiError` none of them have heard of.
 *
 * That mapping is the part worth pinning precisely. A network blip mistaken
 * for `TripNotFoundError` tells someone their trip was deleted because the
 * server restarted.
 */

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'A week in Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2027-09-02',
        destination: 'Yerevan',
        summary: 'Arrival',
        activities: [],
      },
    ],
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = makeTrip();

  return { ...draft, ...overrides };
}

const ATTRACTION: Activity = {
  id: 'otm_matenadaran',
  title: 'Matenadaran',
  category: 'culture',
  description: 'A library of manuscripts.',
  price: 0,
  rating: 5,
  reviews: 120,
  image: '/matenadaran.jpg',
};

/** The API refusing with one of its own codes. */
function apiFails(code: string, status = 400) {
  return new ApiError(status, code as never, 'Nope.');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getTrips', () => {
  it('asks the trips endpoint', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([makeTrip()]);

    await expect(tripService.getTrips()).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/trips');
  });
});

describe('getTripById', () => {
  it('returns the trip', async () => {
    vi.spyOn(http, 'get').mockResolvedValue(makeTrip());

    await expect(tripService.getTripById('trip_1')).resolves.toMatchObject({ id: 'trip_1' });
  });

  it('escapes the id in the path', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue(makeTrip());

    await tripService.getTripById('trip/../admin');

    expect(get).toHaveBeenCalledWith('/trips/trip%2F..%2Fadmin');
  });

  it('answers undefined for a trip that is not there', async () => {
    vi.spyOn(http, 'get').mockRejectedValue(apiFails(ERROR_CODES.TRIP_NOT_FOUND, 404));

    // Undefined rather than a throw: `useTripDetails` reads it as `notFound`.
    await expect(tripService.getTripById('trip_gone')).resolves.toBeUndefined();
  });

  it('does not turn a server failure into a missing trip', async () => {
    vi.spyOn(http, 'get').mockRejectedValue(apiFails(ERROR_CODES.INTERNAL, 500));

    // Answering `undefined` here would render "this trip no longer exists"
    // because the server restarted.
    await expect(tripService.getTripById('trip_1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createTrip', () => {
  it('posts the draft', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(makeTrip());
    const draft = makeDraft({ draftId: 'draft_1' });

    await expect(tripService.createTrip(draft)).resolves.toMatchObject({ id: 'trip_1' });
    expect(post).toHaveBeenCalledWith('/trips', draft);
  });

  it('returns whatever the server says the trip is', async () => {
    // Saving the same draft twice answers with the trip that already exists,
    // which may differ from the draft just sent.
    vi.spyOn(http, 'post').mockResolvedValue(makeTrip({ title: 'The saved one' }));

    const trip = await tripService.createTrip(makeDraft({ title: 'A later edit' }));

    expect(trip.title).toBe('The saved one');
  });
});

describe('updateTrip', () => {
  it('patches the trip', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeTrip({ title: 'Renamed' }));

    await expect(tripService.updateTrip('trip_1', { title: 'Renamed' })).resolves.toMatchObject({
      title: 'Renamed',
    });
    expect(patch).toHaveBeenCalledWith('/trips/trip_1', { title: 'Renamed' });
  });

  it('sends an empty patch as a touch', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeTrip());

    await tripService.updateTrip('trip_1', {});

    // The summary screen's Save does this deliberately, to bump `updatedAt`.
    expect(patch).toHaveBeenCalledWith('/trips/trip_1', {});
  });

  it('sends null through, so a field can be cleared', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeTrip());

    await tripService.updateTrip('trip_1', { destinationCountry: null });

    expect(patch).toHaveBeenCalledWith('/trips/trip_1', { destinationCountry: null });
  });

  it('reports a missing trip as TripNotFoundError', async () => {
    vi.spyOn(http, 'patch').mockRejectedValue(apiFails(ERROR_CODES.TRIP_NOT_FOUND, 404));

    await expect(tripService.updateTrip('trip_gone', {})).rejects.toBeInstanceOf(TripNotFoundError);
  });

  it('reports a conflicting edit as StaleTripError', async () => {
    vi.spyOn(http, 'patch').mockRejectedValue(apiFails(ERROR_CODES.STALE_TRIP, 409));

    // Two tabs on one trip. The screen offers a reload rather than pretending
    // the save landed.
    await expect(tripService.updateTrip('trip_1', {})).rejects.toBeInstanceOf(StaleTripError);
  });

  it('lets an unrecognised failure through untouched', async () => {
    vi.spyOn(http, 'patch').mockRejectedValue(apiFails(ERROR_CODES.NETWORK, 0));

    const caught = await tripService.updateTrip('trip_1', {}).catch((error) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).not.toBeInstanceOf(TripNotFoundError);
  });
});

describe('deleteTrip', () => {
  it('deletes the trip', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await tripService.deleteTrip('trip_1');

    expect(remove).toHaveBeenCalledWith('/trips/trip_1');
  });
});

describe('addActivityToDay', () => {
  it('posts the attraction to the day', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(makeTrip());

    await tripService.addActivityToDay('trip_1', 'day-1', ATTRACTION, { time: '09:30' });

    expect(post).toHaveBeenCalledWith('/trips/trip_1/days/day-1/activities', {
      activity: {
        id: 'otm_matenadaran',
        title: 'Matenadaran',
        description: 'A library of manuscripts.',
        category: 'culture',
        price: 0,
        image: '/matenadaran.jpg',
        coordinates: undefined,
      },
      time: '09:30',
    });
  });

  it('sends no time when none was chosen, so the server picks the default', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(makeTrip());

    await tripService.addActivityToDay('trip_1', 'day-1', ATTRACTION, { time: '   ' });

    expect(post.mock.calls[0][1]).toMatchObject({ time: undefined });
  });

  it('leaves the display-only fields behind', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(makeTrip());

    await tripService.addActivityToDay('trip_1', 'day-1', ATTRACTION);

    // `rating` and `reviews` belong to the explorer listing, not the itinerary.
    const sent = post.mock.calls[0][1] as { activity: Record<string, unknown> };
    expect(sent.activity).not.toHaveProperty('rating');
    expect(sent.activity).not.toHaveProperty('reviews');
  });

  it('reports a missing day as ItineraryDayNotFoundError', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(apiFails(ERROR_CODES.DAY_NOT_FOUND, 404));

    await expect(
      tripService.addActivityToDay('trip_1', 'day_gone', ATTRACTION),
    ).rejects.toBeInstanceOf(ItineraryDayNotFoundError);
  });

  it('reports a repeat as ActivityAlreadyOnDayError, naming the place', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(apiFails(ERROR_CODES.ACTIVITY_ALREADY_ON_DAY, 409));

    const caught = await tripService
      .addActivityToDay('trip_1', 'day-1', ATTRACTION)
      .catch((error) => error);

    expect(caught).toBeInstanceOf(ActivityAlreadyOnDayError);
    expect(caught.message).toContain('Matenadaran');
  });

  it('reports a missing trip as TripNotFoundError', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(apiFails(ERROR_CODES.TRIP_NOT_FOUND, 404));

    await expect(
      tripService.addActivityToDay('trip_gone', 'day-1', ATTRACTION),
    ).rejects.toBeInstanceOf(TripNotFoundError);
  });
});

describe('the active trip', () => {
  it('reads the pointer off the current user', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ activeTripId: 'trip_7' });

    await expect(tripService.getActiveTripId()).resolves.toBe('trip_7');
  });

  it('is null when nothing has been opened', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ activeTripId: null });

    await expect(tripService.getActiveTripId()).resolves.toBeNull();
  });

  it('records the trip', async () => {
    const put = vi.spyOn(http, 'put').mockResolvedValue(undefined);

    await tripService.setActiveTrip('trip_1');

    expect(put).toHaveBeenCalledWith('/me/active-trip', { tripId: 'trip_1' });
  });

  it('clears the pointer', async () => {
    const put = vi.spyOn(http, 'put').mockResolvedValue(undefined);

    await tripService.setActiveTrip(null);

    expect(put).toHaveBeenCalledWith('/me/active-trip', { tripId: null });
  });
});

/* ------------------------------------------------- the pure helpers, unmoved */

describe('minutesOf', () => {
  it('orders a morning before an afternoon', () => {
    expect(minutesOf('09:30')).toBeLessThan(minutesOf('14:00'));
  });

  it('sinks anything unparseable to the end', () => {
    expect(minutesOf('later')).toBe(Number.MAX_SAFE_INTEGER);
    expect(minutesOf('')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('ignores surrounding space', () => {
    expect(minutesOf('  09:30 ')).toBe(570);
  });
});

describe('toItineraryActivity', () => {
  it('carries the source id, so a repeat can be recognised', () => {
    const entry = toItineraryActivity(ATTRACTION, '09:30');

    expect(entry.sourceActivityId).toBe('otm_matenadaran');
    expect(entry.id).toMatch(/^act_/);
  });

  it('leaves the price off when nobody quoted one', () => {
    // Zero means unpriced, which is not the same as free.
    expect(toItineraryActivity(ATTRACTION, '09:30').priceEstimate).toBeUndefined();
  });

  it('keeps a real price', () => {
    const entry = toItineraryActivity({ ...ATTRACTION, price: 18 }, '09:30');

    expect(entry.priceEstimate).toBe(18);
  });
});
