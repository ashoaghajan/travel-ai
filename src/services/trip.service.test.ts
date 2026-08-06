/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TripDraft } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import {
  ActivityAlreadyOnDayError,
  ItineraryDayNotFoundError,
  TripNotFoundError,
  readActiveTripId,
  readTripsSync,
  tripService,
} from './trip.service';

function makeDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    draftId: 'draft_test',
    title: 'Bali Adventure',
    destination: 'Bali',
    startDate: '2027-05-20',
    endDate: '2027-05-26',
    travellers: 2,
    coverImage: '/bali.jpg',
    itinerary: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2027-05-20',
        destination: 'Ubud',
        summary: 'Welcome & relax',
        activities: [],
      },
    ],
    flightsEstimate: 2248,
    hotelsEstimate: 1080,
    activitiesEstimate: 570,
    ...overrides,
  };
}

describe('getTrips', () => {
  it('starts empty', async () => {
    await expect(tripService.getTrips()).resolves.toEqual([]);
  });

  it('returns an empty list when the stored value is not an array', async () => {
    storageService.set(STORAGE_KEYS.trips, { not: 'an array' });
    await expect(tripService.getTrips()).resolves.toEqual([]);
  });

  it('returns an empty list when the stored value is corrupt', async () => {
    localStorage.setItem(STORAGE_KEYS.trips, 'not json at all');
    await expect(tripService.getTrips()).resolves.toEqual([]);
  });
});

describe('createTrip', () => {
  it('assigns an id and timestamps', async () => {
    const trip = await tripService.createTrip(makeDraft());

    expect(trip.id).toMatch(/^trip_/);
    expect(trip.createdAt).toEqual(expect.any(String));
    expect(trip.updatedAt).toBe(trip.createdAt);
  });

  it('keeps the draft fields', async () => {
    const draft = makeDraft();
    const trip = await tripService.createTrip(draft);

    expect(trip).toMatchObject({
      title: draft.title,
      destination: draft.destination,
      travellers: draft.travellers,
      itinerary: draft.itinerary,
    });
  });

  it('persists the trip', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await expect(tripService.getTrips()).resolves.toEqual([trip]);
  });

  it('puts the newest trip first', async () => {
    const first = await tripService.createTrip(makeDraft({ draftId: 'draft_a', title: 'A' }));
    const second = await tripService.createTrip(makeDraft({ draftId: 'draft_b', title: 'B' }));

    const trips = await tripService.getTrips();
    expect(trips.map((trip) => trip.id)).toEqual([second.id, first.id]);
  });

  describe('duplicate prevention', () => {
    it('returns the existing trip when the same draft is saved twice', async () => {
      const first = await tripService.createTrip(makeDraft());
      const second = await tripService.createTrip(makeDraft());

      expect(second.id).toBe(first.id);
      await expect(tripService.getTrips()).resolves.toHaveLength(1);
    });

    it('still dedupes after the saved trip has been edited', async () => {
      const first = await tripService.createTrip(makeDraft());
      await tripService.updateTrip(first.id, { title: 'Renamed' });

      const again = await tripService.createTrip(makeDraft());

      expect(again.id).toBe(first.id);
      expect(again.title).toBe('Renamed');
      await expect(tripService.getTrips()).resolves.toHaveLength(1);
    });

    it('treats a different draft as a new trip', async () => {
      await tripService.createTrip(makeDraft({ draftId: 'draft_a' }));
      await tripService.createTrip(makeDraft({ draftId: 'draft_b' }));

      await expect(tripService.getTrips()).resolves.toHaveLength(2);
    });

    it('always creates when the draft has no id', async () => {
      await tripService.createTrip(makeDraft({ draftId: undefined }));
      await tripService.createTrip(makeDraft({ draftId: undefined }));

      await expect(tripService.getTrips()).resolves.toHaveLength(2);
    });
  });
});

describe('getTripById', () => {
  it('finds a saved trip', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await expect(tripService.getTripById(trip.id)).resolves.toEqual(trip);
  });

  it('resolves undefined for an unknown id', async () => {
    await expect(tripService.getTripById('trip_nope')).resolves.toBeUndefined();
  });
});

describe('updateTrip', () => {
  it('persists the change', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await tripService.updateTrip(trip.id, { title: 'Bali, take two' });

    await expect(tripService.getTripById(trip.id)).resolves.toMatchObject({
      title: 'Bali, take two',
    });
  });

  it('bumps updatedAt but keeps id, createdAt and draftId', async () => {
    const trip = await tripService.createTrip(makeDraft());
    const updated = await tripService.updateTrip(trip.id, { travellers: 4 });

    expect(updated.id).toBe(trip.id);
    expect(updated.createdAt).toBe(trip.createdAt);
    expect(updated.draftId).toBe(trip.draftId);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(trip.createdAt).getTime(),
    );
  });

  it('leaves untouched fields alone', async () => {
    const trip = await tripService.createTrip(makeDraft());
    const updated = await tripService.updateTrip(trip.id, { title: 'New' });

    expect(updated.itinerary).toEqual(trip.itinerary);
    expect(updated.destination).toBe(trip.destination);
  });

  it('does not disturb other trips', async () => {
    const first = await tripService.createTrip(makeDraft({ draftId: 'draft_a', title: 'A' }));
    const second = await tripService.createTrip(makeDraft({ draftId: 'draft_b', title: 'B' }));

    await tripService.updateTrip(first.id, { title: 'A renamed' });

    await expect(tripService.getTripById(second.id)).resolves.toMatchObject({ title: 'B' });
  });

  it('throws TripNotFoundError for an unknown id', async () => {
    await expect(tripService.updateTrip('trip_nope', { title: 'x' })).rejects.toThrow(
      TripNotFoundError,
    );
  });
});

describe('deleteTrip', () => {
  it('removes the trip', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await tripService.deleteTrip(trip.id);

    await expect(tripService.getTrips()).resolves.toEqual([]);
  });

  it('leaves the other trips in place', async () => {
    const first = await tripService.createTrip(makeDraft({ draftId: 'draft_a' }));
    const second = await tripService.createTrip(makeDraft({ draftId: 'draft_b' }));

    await tripService.deleteTrip(first.id);

    const trips = await tripService.getTrips();
    expect(trips.map((trip) => trip.id)).toEqual([second.id]);
  });

  it('is harmless for an unknown id', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await expect(tripService.deleteTrip('trip_nope')).resolves.toBeUndefined();
    await expect(tripService.getTrips()).resolves.toHaveLength(1);
    expect(trip.id).toBeDefined();
  });

  it('clears the active pointer when it aimed at the deleted trip', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await tripService.setActiveTrip(trip.id);

    await tripService.deleteTrip(trip.id);

    expect(readActiveTripId()).toBeNull();
  });

  it('leaves the active pointer alone when another trip is deleted', async () => {
    const kept = await tripService.createTrip(makeDraft({ draftId: 'draft_a' }));
    const removed = await tripService.createTrip(makeDraft({ draftId: 'draft_b' }));
    await tripService.setActiveTrip(kept.id);

    await tripService.deleteTrip(removed.id);

    expect(readActiveTripId()).toBe(kept.id);
  });
});

describe('setActiveTrip', () => {
  it('stores the id', async () => {
    await tripService.setActiveTrip('trip_123');
    expect(readActiveTripId()).toBe('trip_123');
  });

  it('clears the pointer when passed null', async () => {
    await tripService.setActiveTrip('trip_123');
    await tripService.setActiveTrip(null);

    expect(readActiveTripId()).toBeNull();
  });
});

describe('readTripsSync', () => {
  it('sees what the async API wrote', async () => {
    const trip = await tripService.createTrip(makeDraft());
    expect(readTripsSync()).toEqual([trip]);
  });
});

describe('storage integration', () => {
  beforeEach(async () => {
    await tripService.createTrip(makeDraft());
  });

  it('writes under the trips key', () => {
    expect(localStorage.getItem(STORAGE_KEYS.trips)).not.toBeNull();
  });

  it('notifies subscribers when trips change', async () => {
    let notified = 0;
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, () => {
      notified += 1;
    });

    await tripService.createTrip(makeDraft({ draftId: 'draft_other' }));

    expect(notified).toBe(1);
    unsubscribe();
  });
});

/* -------------------------------------------- attractions from the explorer */

function attraction(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    title: `Place ${id}`,
    category: 'culture',
    description: 'Museums · 1.2 km from centre',
    price: 0,
    rating: 5,
    reviews: 0,
    image: 'city.jpg',
    coordinates: { lat: -8.65, lng: 115.2 },
    ...overrides,
  };
}

describe('addActivityToDay', () => {
  it('adds the attraction to the chosen day', async () => {
    const trip = await tripService.createTrip(makeDraft());

    const updated = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    expect(updated.itinerary[0].activities).toHaveLength(1);
    expect(updated.itinerary[0].activities[0].title).toBe('Place N1');
  });

  it('marks where it came from, so the import can be traced', async () => {
    const trip = await tripService.createTrip(makeDraft());

    const updated = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    expect(updated.itinerary[0].activities[0]).toMatchObject({
      sourceActivityId: 'N1',
      coordinates: { lat: -8.65, lng: 115.2 },
      category: 'culture',
    });
  });

  it('gives the entry its own id, not the attraction’s', async () => {
    const trip = await tripService.createTrip(makeDraft());

    const updated = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    expect(updated.itinerary[0].activities[0].id).not.toBe('N1');
  });

  it('carries a price only when there is one', async () => {
    const trip = await tripService.createTrip(makeDraft());

    const free = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));
    expect(free.itinerary[0].activities[0].priceEstimate).toBeUndefined();

    const paid = await tripService.addActivityToDay(
      trip.id,
      'day-1',
      attraction('N2', { price: 45 }),
    );
    const entry = paid.itinerary[0].activities.find((a) => a.sourceActivityId === 'N2');
    expect(entry?.priceEstimate).toBe(45);
  });

  it('keeps the day in time order', async () => {
    const trip = await tripService.createTrip(
      makeDraft({
        itinerary: [
          {
            id: 'day-1',
            dayNumber: 1,
            date: '2027-05-20',
            destination: 'Ubud',
            summary: 'Welcome',
            activities: [
              { id: 'a1', time: '09:00', title: 'Morning', description: '', category: 'nature' },
              { id: 'a2', time: '18:30', title: 'Dinner', description: '', category: 'food' },
            ],
          },
        ],
      }),
    );

    const updated = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    expect(updated.itinerary[0].activities.map((a) => a.time)).toEqual(['09:00', '12:00', '18:30']);
  });

  it('honours an explicit time', async () => {
    const trip = await tripService.createTrip(makeDraft());

    const updated = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'), {
      time: '07:15',
    });

    expect(updated.itinerary[0].activities[0].time).toBe('07:15');
  });

  it('persists immediately and bumps updatedAt', async () => {
    const trip = await tripService.createTrip(makeDraft());

    const updated = await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    const stored = readTripsSync().find((candidate) => candidate.id === trip.id);
    expect(stored?.itinerary[0].activities).toHaveLength(1);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(trip.createdAt));
  });

  it('leaves the other days alone', async () => {
    const trip = await tripService.createTrip(
      makeDraft({
        itinerary: [
          {
            id: 'day-1',
            dayNumber: 1,
            date: '2027-05-20',
            destination: 'Ubud',
            summary: 'A',
            activities: [],
          },
          {
            id: 'day-2',
            dayNumber: 2,
            date: '2027-05-21',
            destination: 'Ubud',
            summary: 'B',
            activities: [],
          },
        ],
      }),
    );

    const updated = await tripService.addActivityToDay(trip.id, 'day-2', attraction('N1'));

    expect(updated.itinerary[0].activities).toHaveLength(0);
    expect(updated.itinerary[1].activities).toHaveLength(1);
  });

  it('refuses the same attraction twice on one day', async () => {
    const trip = await tripService.createTrip(makeDraft());
    await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    await expect(
      tripService.addActivityToDay(trip.id, 'day-1', attraction('N1')),
    ).rejects.toThrow(ActivityAlreadyOnDayError);
  });

  it('allows the same attraction on a different day', async () => {
    const trip = await tripService.createTrip(
      makeDraft({
        itinerary: [
          {
            id: 'day-1',
            dayNumber: 1,
            date: '2027-05-20',
            destination: 'Ubud',
            summary: 'A',
            activities: [],
          },
          {
            id: 'day-2',
            dayNumber: 2,
            date: '2027-05-21',
            destination: 'Ubud',
            summary: 'B',
            activities: [],
          },
        ],
      }),
    );
    await tripService.addActivityToDay(trip.id, 'day-1', attraction('N1'));

    await expect(
      tripService.addActivityToDay(trip.id, 'day-2', attraction('N1')),
    ).resolves.toBeDefined();
  });

  it('rejects an unknown trip', async () => {
    await expect(
      tripService.addActivityToDay('missing', 'day-1', attraction('N1')),
    ).rejects.toThrow(TripNotFoundError);
  });

  it('rejects an unknown day', async () => {
    const trip = await tripService.createTrip(makeDraft());

    await expect(
      tripService.addActivityToDay(trip.id, 'day-99', attraction('N1')),
    ).rejects.toThrow(ItineraryDayNotFoundError);
  });
});
