/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { offlineSnapshotService } from './offlineSnapshot.service';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import type { Trip } from '../types/trip.types';

const trip: Trip = {
  id: 'trip_offline', title: 'Offline Yerevan', destination: 'Yerevan', startDate: '2027-09-01',
  endDate: '2027-09-03', travellers: 1, coverImage: '', itinerary: [], createdAt: 'x', updatedAt: 'x',
};

afterEach(() => {
  storageService.remove(STORAGE_KEYS.offlineTrips);
  storageService.remove(STORAGE_KEYS.offlineBookings);
});

describe('offlineSnapshotService', () => {
  it('stores a server-confirmed list and when it was cached', () => {
    offlineSnapshotService.writeTrips([trip]);
    const snapshot = offlineSnapshotService.readTrips();
    expect(snapshot?.data).toEqual([trip]);
    expect(Number.isNaN(Date.parse(snapshot?.savedAt ?? ''))).toBe(false);
  });

  it('ignores a corrupt snapshot', () => {
    storageService.set(STORAGE_KEYS.offlineTrips, '{broken' as never);
    expect(offlineSnapshotService.readTrips()).toBeNull();
  });
});
