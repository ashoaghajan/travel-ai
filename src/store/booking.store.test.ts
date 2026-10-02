/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { Booking } from '../types/booking.types';
import { ApiError } from '../services/http';
import { bookingService } from '../services/booking.service';
import { offlineSnapshotService } from '../services/offlineSnapshot.service';
import { bookingStore } from './booking.store';

const cached: Booking = {
  id: 'booking-1', tripId: 'trip-1', kind: 'flight', status: 'booked', title: 'Flight to Lisbon',
  date: '2027-06-01', reference: 'AB123', createdAt: 'x', updatedAt: 'x',
};

beforeEach(() => {
  localStorage.clear();
  bookingStore.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  bookingStore.reset();
  localStorage.clear();
});

describe('offline booking snapshots', () => {
  it('loads the last confirmed booking list after a network failure', async () => {
    offlineSnapshotService.writeBookings([cached]);
    vi.spyOn(bookingService, 'getBookings').mockRejectedValue(
      new ApiError(0, ERROR_CODES.NETWORK, 'Offline'),
    );

    await bookingStore.refresh();

    expect(bookingStore.getSnapshot().data).toEqual([cached]);
    expect(bookingStore.getOfflineSnapshotAt()).not.toBeNull();
  });

  it('does not treat a server error as offline data', async () => {
    offlineSnapshotService.writeBookings([cached]);
    vi.spyOn(bookingService, 'getBookings').mockRejectedValue(
      new ApiError(503, ERROR_CODES.INTERNAL, 'Unavailable'),
    );

    await bookingStore.refresh();

    expect(bookingStore.getSnapshot()).toMatchObject({ status: 'error', data: [] });
    expect(bookingStore.getOfflineSnapshotAt()).toBeNull();
  });
});
