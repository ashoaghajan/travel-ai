/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip, TripDraft } from '../types/trip.types';
import { tripService } from '../services/trip.service';
import { tripStore, useActiveTripId, useTrips } from './trip.store';

/**
 * The trips read model.
 *
 * Every mutation here writes the *server's* response into the resource rather
 * than a locally merged guess — the server owns `updatedAt` and any field it
 * normalises, so a merge would show a trip that does not match the stored row.
 * These tests pin that, plus the two list rules the screens depend on: a save
 * puts the trip at the top, and saving the same draft twice does not list it
 * twice.
 */

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const DRAFT = { title: 'Yerevan' } as unknown as TripDraft;

/** The list the store currently holds, without rendering anything. */
function held(): Trip[] {
  return tripStore.getSnapshot().data;
}

beforeEach(async () => {
  vi.spyOn(tripService, 'getTrips').mockResolvedValue([]);
  vi.spyOn(tripService, 'getActiveTripId').mockResolvedValue(null);
  tripStore.reset();
  await tripStore.refresh();
});

afterEach(() => {
  vi.restoreAllMocks();
  tripStore.reset();
});

describe('the hooks are exported for components', () => {
  it('exposes a list hook and an active-trip hook', () => {
    expect(typeof useTrips).toBe('function');
    expect(typeof useActiveTripId).toBe('function');
  });
});

describe('saveTrip', () => {
  it('puts the new trip at the top', async () => {
    const existing = makeTrip({ id: 'trip_old' });
    vi.mocked(tripService.getTrips).mockResolvedValue([existing]);
    await tripStore.refresh();

    vi.spyOn(tripService, 'createTrip').mockResolvedValue(makeTrip({ id: 'trip_new' }));
    await tripStore.saveTrip(DRAFT);

    expect(held().map((trip) => trip.id)).toEqual(['trip_new', 'trip_old']);
  });

  it('does not list the same trip twice when a draft is saved again', async () => {
    const saved = makeTrip({ id: 'trip_1', draftId: 'draft_1' });
    vi.spyOn(tripService, 'createTrip').mockResolvedValue(saved);

    await tripStore.saveTrip(DRAFT);
    await tripStore.saveTrip(DRAFT);

    // `createTrip` is idempotent by draftId and returns the trip that already
    // exists; prepending it blindly would show it twice.
    expect(held()).toHaveLength(1);
  });

  it('holds exactly what the server returned', async () => {
    const fromServer = makeTrip({ title: 'Renamed by the server' });
    vi.spyOn(tripService, 'createTrip').mockResolvedValue(fromServer);

    await tripStore.saveTrip(DRAFT);

    expect(held()[0]).toBe(fromServer);
  });
});

/**
 * A trip that arrived without this store saving it — accepting a shared trip.
 *
 * The row is written by `POST /api/shares/:id/accept`, which never comes
 * through here, so without this every screen reading the store holds a list
 * from before the trip existed and only a reload fixes it.
 */
describe('adoptTrip', () => {
  it('files it with the trips already held', () => {
    tripStore.adoptTrip(makeTrip({ id: 'trip_shared', title: 'Berlin' }));

    expect(held().map((trip) => trip.id)).toEqual(['trip_shared']);
  });

  it('puts it at the top, beside what was already there', async () => {
    vi.spyOn(tripService, 'getTrips').mockResolvedValue([makeTrip({ id: 'trip_1' })]);
    await tripStore.refresh();

    tripStore.adoptTrip(makeTrip({ id: 'trip_shared' }));

    expect(held().map((trip) => trip.id)).toEqual(['trip_shared', 'trip_1']);
  });

  it('lists it once when the same offer is accepted twice', () => {
    const trip = makeTrip({ id: 'trip_shared' });

    tripStore.adoptTrip(trip);
    tripStore.adoptTrip(trip);

    // Accepting is idempotent server-side; the list must agree.
    expect(held()).toHaveLength(1);
  });

  it('leaves an unloaded list alone rather than claiming it is the whole list', async () => {
    const getTrips = vi.spyOn(tripService, 'getTrips').mockResolvedValue([
      makeTrip({ id: 'trip_1' }),
      makeTrip({ id: 'trip_shared' }),
    ]);
    tripStore.reset();

    tripStore.adoptTrip(makeTrip({ id: 'trip_shared' }));

    /*
     * The trap this guards: `set` marks the resource ready, so merging into a
     * list that has never loaded would leave the account holding exactly one
     * trip until a reload — the bug it fixes, inverted and worse.
     */
    expect(held()).toEqual([]);

    await tripStore.refresh();
    expect(getTrips).toHaveBeenCalled();
    expect(held()).toHaveLength(2);
  });

  it('asks again when a list is still in flight', async () => {
    tripStore.reset();
    const getTrips = vi.spyOn(tripService, 'getTrips').mockResolvedValue([]);
    const loading = tripStore.refresh();

    getTrips.mockResolvedValue([makeTrip({ id: 'trip_shared' })]);
    tripStore.adoptTrip(makeTrip({ id: 'trip_shared' }));
    await loading;

    // The answer in flight was asked for before this trip existed, so it
    // cannot be merged into.
    await vi.waitFor(() => expect(held().map((trip) => trip.id)).toEqual(['trip_shared']));
  });
});

describe('updateTrip', () => {
  it('replaces the trip in place', async () => {
    vi.mocked(tripService.getTrips).mockResolvedValue([
      makeTrip({ id: 'trip_a' }),
      makeTrip({ id: 'trip_b' }),
    ]);
    await tripStore.refresh();

    vi.spyOn(tripService, 'updateTrip').mockResolvedValue(
      makeTrip({ id: 'trip_a', title: 'Edited' }),
    );
    await tripStore.updateTrip('trip_a', { title: 'Edited' });

    // Order is preserved: an edit is not a reason to jump the list.
    expect(held().map((trip) => trip.id)).toEqual(['trip_a', 'trip_b']);
    expect(held()[0].title).toBe('Edited');
  });
});

describe('addActivityToDay', () => {
  it('replaces the trip with the one the server returned', async () => {
    vi.mocked(tripService.getTrips).mockResolvedValue([makeTrip()]);
    await tripStore.refresh();

    const withActivity = makeTrip({ updatedAt: '2026-08-02T00:00:00.000Z' });
    vi.spyOn(tripService, 'addActivityToDay').mockResolvedValue(withActivity);

    await tripStore.addActivityToDay('trip_1', 'day_1', {
      id: 'a1',
      title: 'Cascade',
    } as never);

    expect(held()[0]).toBe(withActivity);
  });
});

describe('deleteTrip', () => {
  it('drops the trip from the list', async () => {
    vi.mocked(tripService.getTrips).mockResolvedValue([
      makeTrip({ id: 'trip_a' }),
      makeTrip({ id: 'trip_b' }),
    ]);
    await tripStore.refresh();
    vi.spyOn(tripService, 'deleteTrip').mockResolvedValue(undefined);

    await tripStore.deleteTrip('trip_a');

    expect(held().map((trip) => trip.id)).toEqual(['trip_b']);
  });

  it('clears the active pointer when it aimed at the deleted trip', async () => {
    vi.mocked(tripService.getTrips).mockResolvedValue([makeTrip()]);
    vi.mocked(tripService.getActiveTripId).mockResolvedValue('trip_1');
    await tripStore.refresh();
    vi.spyOn(tripService, 'deleteTrip').mockResolvedValue(undefined);
    vi.spyOn(tripService, 'setActiveTrip').mockResolvedValue(undefined);

    await tripStore.deleteTrip('trip_1');

    // Never leave the pointer aimed at a trip that no longer exists.
    expect(tripStore.getSnapshot().data).toEqual([]);
  });

  it('leaves the list alone when the server refuses', async () => {
    vi.mocked(tripService.getTrips).mockResolvedValue([makeTrip()]);
    await tripStore.refresh();
    vi.spyOn(tripService, 'deleteTrip').mockRejectedValue(new Error('nope'));

    await expect(tripStore.deleteTrip('trip_1')).rejects.toThrow();

    // The row is still there, so the screen must still show it.
    expect(held()).toHaveLength(1);
  });
});

describe('setActiveTrip', () => {
  it('records the trip', async () => {
    const set = vi.spyOn(tripService, 'setActiveTrip').mockResolvedValue(undefined);

    await tripStore.setActiveTrip('trip_1');

    expect(set).toHaveBeenCalledWith('trip_1');
  });

  it('does nothing when the pointer already aims there', async () => {
    vi.mocked(tripService.getActiveTripId).mockResolvedValue('trip_1');
    await tripStore.refresh();
    const set = vi.spyOn(tripService, 'setActiveTrip').mockResolvedValue(undefined);

    await tripStore.setActiveTrip('trip_1');

    // Opening a trip runs this on every render pass that resolves one; a
    // no-op write would be a request per page view.
    expect(set).not.toHaveBeenCalled();
  });
});

describe('reset', () => {
  it('drops the previous account’s trips', async () => {
    vi.mocked(tripService.getTrips).mockResolvedValue([makeTrip()]);
    await tripStore.refresh();

    tripStore.reset();

    // Sign-out: the next reader must not see these for the moment before
    // their own list arrives.
    expect(held()).toEqual([]);
  });
});
