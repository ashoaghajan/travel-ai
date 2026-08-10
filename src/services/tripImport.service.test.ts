/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS, archiveKey, storageService } from './localStorage.service';
import { tripImportService } from './tripImport.service';
import { ApiError, http } from './http';

/**
 * Handing a browser's trips to the account that just signed in.
 *
 * This is the one path in the app that can lose data someone cannot get back:
 * before the trips API, a browser's `localStorage` was the only copy that ever
 * existed. So the rules here are defensive rather than clever — a failure must
 * change nothing, a success must archive rather than delete, and neither must
 * ever block someone from signing in.
 */

const USER = 'user_1';

function makeTrip(id = 'trip_1'): Trip {
  return {
    id,
    title: 'A week in Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function seedLocalTrips(trips: Trip[], activeTripId?: string) {
  storageService.set(STORAGE_KEYS.trips, trips);
  if (activeTripId) storageService.set(STORAGE_KEYS.activeTripId, activeTripId);
}

function apiAccepts(imported = 1, alreadyMigrated = false, importedBookings = 0) {
  return vi
    .spyOn(http, 'post')
    .mockResolvedValue({ alreadyMigrated, imported, importedBookings });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('when there is nothing to hand over', () => {
  it('makes no request', async () => {
    const post = apiAccepts();

    await expect(tripImportService.run(USER)).resolves.toEqual({ status: 'skipped' });

    // The common case by far — a new account on a fresh browser — and it must
    // cost nothing.
    expect(post).not.toHaveBeenCalled();
  });

  it('still records that this browser has nothing, so it stops asking', async () => {
    await tripImportService.run(USER);

    expect(tripImportService.hasRun(USER)).toBe(true);
  });
});

describe('a successful import', () => {
  it('sends the local trips and the active pointer', async () => {
    const post = apiAccepts();
    seedLocalTrips([makeTrip()], 'trip_1');

    await expect(tripImportService.run(USER)).resolves.toEqual({
      status: 'imported',
      trips: 1,
      bookings: 0,
    });

    // Bookings travel with the trips they belong to, in one payload — see the
    // migration route for why they cannot be two calls.
    expect(post).toHaveBeenCalledWith('/migrate/local', {
      trips: [makeTrip()],
      bookings: [],
      activeTripId: 'trip_1',
    });
  });

  it('archives the local keys rather than deleting them', async () => {
    apiAccepts();
    seedLocalTrips([makeTrip()], 'trip_1');

    await tripImportService.run(USER);

    // The upload has no undo, and until someone has seen their trips in the
    // new account this is the only copy that was ever theirs.
    expect(storageService.get(archiveKey(USER, STORAGE_KEYS.trips), null)).toEqual([makeTrip()]);
    expect(storageService.get(STORAGE_KEYS.trips, null)).toBeNull();
  });

  it('does not ask again for the same account', async () => {
    const post = apiAccepts();
    seedLocalTrips([makeTrip()]);

    await tripImportService.run(USER);
    await tripImportService.run(USER);

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports an already-claimed account as nothing to do', async () => {
    apiAccepts(0, true);
    seedLocalTrips([makeTrip()]);

    // A second device whose account already claimed a browser's data.
    await expect(tripImportService.run(USER)).resolves.toEqual({ status: 'skipped' });
  });
});

describe('a failed import', () => {
  it('reports the failure rather than throwing', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(new ApiError(502, ERROR_CODES.INTERNAL, 'Nope.'));
    seedLocalTrips([makeTrip()]);

    // Never throws: a failed import must leave someone signed in with a
    // working app.
    await expect(tripImportService.run(USER)).resolves.toEqual({ status: 'failed' });
  });

  it('leaves the local trips exactly where they were', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(new ApiError(0, ERROR_CODES.NETWORK, 'Offline.'));
    seedLocalTrips([makeTrip()]);

    await tripImportService.run(USER);

    expect(storageService.get(STORAGE_KEYS.trips, null)).toEqual([makeTrip()]);
    expect(storageService.get(archiveKey(USER, STORAGE_KEYS.trips), null)).toBeNull();
  });

  it('does not record it as done, so the next sign-in retries', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(new ApiError(0, ERROR_CODES.NETWORK, 'Offline.'));
    seedLocalTrips([makeTrip()]);

    await tripImportService.run(USER);

    // Half-importing and then marking it done is the one outcome that
    // strands someone's trips on their disk forever.
    expect(tripImportService.hasRun(USER)).toBe(false);
  });
});

describe('two accounts on one browser', () => {
  it('offers the data to the second account as well', async () => {
    apiAccepts();
    seedLocalTrips([makeTrip()]);
    await tripImportService.run(USER);

    // Someone else signs in on this machine. The marker is per account, so
    // their own sign-in is still allowed to try — the server's marker is what
    // stops a genuine duplicate.
    const post = apiAccepts();
    seedLocalTrips([makeTrip('trip_2')]);

    await tripImportService.run('user_2');

    expect(post).toHaveBeenCalled();
  });
});
