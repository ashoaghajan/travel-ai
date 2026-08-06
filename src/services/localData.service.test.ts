/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { claimLocalData, currentOwner, releaseLocalData } from './localData.service';
import { archiveKey, STORAGE_KEYS, storageService } from './localStorage.service';

/** A trip list, standing in for whatever the trip service stores. */
function seedTrips(titles: string[]): void {
  storageService.set(
    STORAGE_KEYS.trips,
    titles.map((title) => ({ id: title, title })),
  );
}

function trips(): { title: string }[] {
  return storageService.get<{ title: string }[]>(STORAGE_KEYS.trips, []);
}

function titles(): string[] {
  return trips().map((trip) => trip.title);
}

beforeEach(() => {
  localStorage.clear();
});

describe('claimLocalData', () => {
  // The trips someone made before accounts existed belong to whoever they are.
  it('hands unowned guest data to the first account that signs in', () => {
    seedTrips(['Bali']);

    claimLocalData('user-1');

    expect(titles()).toEqual(['Bali']);
    expect(currentOwner()).toBe('user-1');
  });

  it('does nothing when the same account signs in again', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');

    claimLocalData('user-1');

    expect(titles()).toEqual(['Bali']);
  });

  // The reason this module exists: a shared browser must not show one person
  // the other's itineraries.
  it('hides the previous account’s trips from the next one', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');

    claimLocalData('user-2');

    expect(trips()).toEqual([]);
    expect(currentOwner()).toBe('user-2');
  });

  it('gives each account its own trips back on return', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');

    claimLocalData('user-2');
    seedTrips(['Lisbon']);

    claimLocalData('user-1');
    expect(titles()).toEqual(['Bali']);

    claimLocalData('user-2');
    expect(titles()).toEqual(['Lisbon']);
  });

  it('archives rather than deletes — it is the only copy', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');
    claimLocalData('user-2');

    const archived = storageService.get<{ title: string }[]>(
      archiveKey('user-1', STORAGE_KEYS.trips),
      [],
    );

    expect(archived.map((trip) => trip.title)).toEqual(['Bali']);
  });

  it('moves every key that belongs to a person', () => {
    storageService.set(STORAGE_KEYS.activeTripId, 'trip_1');
    storageService.set(STORAGE_KEYS.savedActivities, [{ id: 'a' }]);
    storageService.set(STORAGE_KEYS.recentSearches, { flights: [{ from: 'JFK' }] });
    claimLocalData('user-1');

    claimLocalData('user-2');

    expect(storageService.get(STORAGE_KEYS.activeTripId, null)).toBeNull();
    expect(storageService.get(STORAGE_KEYS.savedActivities, [])).toEqual([]);
    expect(storageService.get(STORAGE_KEYS.recentSearches, null)).toBeNull();
  });

  // Reference data is the same answers for everyone and expensive to refetch.
  it('leaves the shared caches alone', () => {
    storageService.set(STORAGE_KEYS.countries, [{ code: 'FR' }]);
    storageService.set(STORAGE_KEYS.geocodes, { Paris: [1, 2] });
    claimLocalData('user-1');

    claimLocalData('user-2');

    expect(storageService.get(STORAGE_KEYS.countries, [])).toEqual([{ code: 'FR' }]);
    expect(storageService.get(STORAGE_KEYS.geocodes, {})).toEqual({ Paris: [1, 2] });
  });

  // An account that already has an archive has the better claim to the app
  // than whatever unowned data happens to be lying about.
  it('prefers the account’s own archive over unowned data', () => {
    storageService.set(archiveKey('user-1', STORAGE_KEYS.trips), [{ id: 'old', title: 'Mine' }]);
    seedTrips(['Not mine']);

    claimLocalData('user-1');

    expect(titles()).toEqual(['Mine']);
  });

  it('parks the unowned data rather than dropping it', () => {
    storageService.set(archiveKey('user-1', STORAGE_KEYS.trips), [{ id: 'old', title: 'Mine' }]);
    seedTrips(['Not mine']);

    claimLocalData('user-1');

    const parked = storageService.get<{ title: string }[]>(
      archiveKey('guest', STORAGE_KEYS.trips),
      [],
    );
    expect(parked.map((trip) => trip.title)).toEqual(['Not mine']);
  });
});

describe('releaseLocalData', () => {
  it('parks the data and leaves the app empty', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');

    releaseLocalData();

    expect(trips()).toEqual([]);
    expect(currentOwner()).toBeNull();
  });

  it('returns the data when the same account signs back in', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');
    releaseLocalData();

    claimLocalData('user-1');

    expect(titles()).toEqual(['Bali']);
  });

  it('does nothing when nobody is signed in', () => {
    seedTrips(['Guest trip']);

    releaseLocalData();

    expect(titles()).toEqual(['Guest trip']);
  });
});

describe('the stores that watch these keys', () => {
  // The whole design rests on this: the keys never change, so the module-level
  // caches in trip.store.ts stay valid and refresh through the subscription.
  it('notifies subscribers when the owner changes', () => {
    seedTrips(['Bali']);
    claimLocalData('user-1');

    let notifications = 0;
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, () => {
      notifications += 1;
    });

    claimLocalData('user-2');

    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
  });
});
