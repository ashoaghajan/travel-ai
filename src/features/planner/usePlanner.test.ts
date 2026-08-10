/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Trip, TripDraft } from '../../types/trip.types';
import { tripService } from '../../services/trip.service';
import { bookingService } from '../../services/booking.service';
import { tripStore } from '../../store/trip.store';
import { bookingStore } from '../../store/booking.store';
import { usePlanner } from './usePlanner';

/**
 * Saving and customising a suggested itinerary.
 *
 * `customiseTrip` is what "Customise Trip" calls, and the whole reason it can
 * save without asking is that saving is idempotent by `draftId`. These pin
 * that, because a regression there means duplicate trips rather than a
 * visible error.
 */

function makeDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    draftId: 'draft_yerevan',
    title: 'Yerevan Trip',
    destination: 'Yerevan',
    startDate: '2027-08-29',
    endDate: '2027-09-02',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2027-08-29',
        destination: 'Yerevan',
        summary: 'Arrival & first impressions',
        activities: [],
      },
    ],
    flightsEstimate: 900,
    hotelsEstimate: 600,
    activitiesEstimate: 300,
    ...overrides,
  };
}

/** A draft with something on its days, for the bookings the save files. */
function withSchedule(): TripDraft {
  return makeDraft({
    itinerary: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2027-08-29',
        destination: 'Yerevan',
        summary: 'Arrival',
        activities: [
          {
            id: 'act-1',
            time: '09:00',
            title: 'Cascade at opening',
            description: 'Before the heat.',
            category: 'culture',
            priceEstimate: 0,
          },
          {
            id: 'act-2',
            time: '14:00',
            title: 'Ararat tour',
            description: 'Brandy and the view.',
            category: 'culture',
            priceEstimate: 18,
          },
        ],
      },
    ],
  });
}

/**
 * An in-memory stand-in for the trips API.
 *
 * These tests are about `usePlanner` — that saving is idempotent by `draftId`,
 * and that one save files one set of bookings. Trips live in Postgres now, so
 * the persistence they used to lean on is gone; this reproduces the one rule
 * they actually depend on (a repeated `draftId` returns the existing trip)
 * without standing up a database for a hook test.
 */
let trips: Trip[] = [];

function fakeTripsApi() {
  trips = [];

  vi.spyOn(tripService, 'getTrips').mockImplementation(async () => trips);
  vi.spyOn(tripService, 'getActiveTripId').mockResolvedValue(null);

  vi.spyOn(tripService, 'createTrip').mockImplementation(async (draft) => {
    // The server's unique constraint, in one line.
    const existing = draft.draftId && trips.find((trip) => trip.draftId === draft.draftId);
    if (existing) return existing;

    const trip: Trip = {
      ...draft,
      id: `trip_${trips.length + 1}`,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };

    trips = [trip, ...trips];

    return trip;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  fakeTripsApi();
  tripStore.reset();
});

describe('customiseTrip', () => {
  it('saves the draft and hands back the trip to open', async () => {
    const { result } = renderHook(() => usePlanner());

    let saved: Awaited<ReturnType<typeof result.current.customiseTrip>> = null;
    await act(async () => {
      saved = await result.current.customiseTrip('message-1', makeDraft());
    });

    expect(saved).not.toBeNull();
    expect(saved!.id).toBeTruthy();
    expect(saved!.title).toBe('Yerevan Trip');

    await expect(tripService.getTrips()).resolves.toHaveLength(1);
  });

  /*
   * The property that lets "Customise Trip" save without asking first. If this
   * breaks, pressing Save Trip and then Customise silently leaves two trips.
   */
  it('returns the same trip when the draft was already saved', async () => {
    const { result } = renderHook(() => usePlanner());
    const draft = makeDraft();

    let first: string | undefined;
    let second: string | undefined;

    await act(async () => {
      first = (await result.current.saveTrip('message-1', draft))?.id;
    });
    await act(async () => {
      second = (await result.current.customiseTrip('message-1', draft))?.id;
    });

    expect(second).toBe(first);
    await expect(tripService.getTrips()).resolves.toHaveLength(1);
  });

  it('is idempotent when customise is pressed twice', async () => {
    const { result } = renderHook(() => usePlanner());
    const draft = makeDraft();

    await act(async () => {
      await result.current.customiseTrip('message-1', draft);
    });
    await act(async () => {
      await result.current.customiseTrip('message-1', draft);
    });

    await expect(tripService.getTrips()).resolves.toHaveLength(1);
  });

  it('still creates separate trips for different drafts', async () => {
    const { result } = renderHook(() => usePlanner());

    await act(async () => {
      await result.current.customiseTrip('message-1', makeDraft({ draftId: 'draft_a' }));
    });
    await act(async () => {
      await result.current.customiseTrip('message-2', makeDraft({ draftId: 'draft_b' }));
    });

    await expect(tripService.getTrips()).resolves.toHaveLength(2);
  });

  // The caller navigates on a trip and stays put on null, so the distinction
  // decides whether someone lands on a page for a trip that does not exist.
  it('answers null and explains itself when the write fails', async () => {
    vi.spyOn(tripStore, 'saveTrip').mockRejectedValue(new Error('storage full'));

    const { result } = renderHook(() => usePlanner());

    let saved: unknown = 'untouched';
    await act(async () => {
      saved = await result.current.customiseTrip('message-1', makeDraft());
    });

    expect(saved).toBeNull();
    await waitFor(() => expect(result.current.error).toMatch(/could not save this trip/i));
  });

  it('clears the saving flag whether it worked or not', async () => {
    const { result } = renderHook(() => usePlanner());

    await act(async () => {
      await result.current.customiseTrip('message-1', makeDraft());
    });

    expect(result.current.savingMessageId).toBeNull();
  });
});

describe('saveTrip', () => {
  it('returns the trip it saved', async () => {
    const { result } = renderHook(() => usePlanner());

    let saved: { id: string } | null = null;
    await act(async () => {
      saved = await result.current.saveTrip('message-1', makeDraft());
    });

    expect(saved).not.toBeNull();
    expect(saved!.id).toBeTruthy();
  });

  it('reports a saved draft back through savedTripIdFor', async () => {
    const { result } = renderHook(() => usePlanner());
    const draft = makeDraft();

    await act(async () => {
      await result.current.saveTrip('message-1', draft);
    });

    await waitFor(() => expect(result.current.savedTripIdFor(draft)).toBeTruthy());
  });

  it('files the schedule as bookings, so the trip does not arrive empty', async () => {
    const { result } = renderHook(() => usePlanner());

    await act(async () => {
      await result.current.saveTrip('message-1', withSchedule());
    });

    const bookings = await bookingService.getBookings();
    expect(bookings.map((booking) => booking.title)).toEqual(['Cascade at opening', 'Ararat tour']);
    // Shortlisted, not booked: the planner cannot reserve anything.
    expect(bookings.every((booking) => booking.status === 'saved')).toBe(true);
  });

  it('does not double the bookings when the same draft is saved twice', async () => {
    const { result } = renderHook(() => usePlanner());
    const draft = withSchedule();

    await act(async () => {
      await result.current.saveTrip('message-1', draft);
    });
    await act(async () => {
      await result.current.customiseTrip('message-1', draft);
    });

    await expect(bookingService.getBookings()).resolves.toHaveLength(2);
  });

  // The trip is already written by the time the bookings are attempted, and
  // reporting a failure would send the reader back to press Save again.
  it('still returns the trip when the bookings cannot be written', async () => {
    vi.spyOn(bookingStore, 'createFromItinerary').mockRejectedValue(new Error('storage full'));

    const { result } = renderHook(() => usePlanner());

    let saved: { id: string } | null = null;
    await act(async () => {
      saved = await result.current.saveTrip('message-1', withSchedule());
    });

    expect(saved).not.toBeNull();
    expect(result.current.error).toBeNull();
    await expect(tripService.getTrips()).resolves.toHaveLength(1);
  });
});
