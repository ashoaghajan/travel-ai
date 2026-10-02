/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { authService } from '../services/auth.service';
import { ApiError, setAccessToken } from '../services/http';
import { offlineSessionService } from '../services/offlineSession.service';
import { DEFAULT_SETTINGS } from '../services/settings.service';
import { STORAGE_KEYS, storageService } from '../services/localStorage.service';
import { authStore } from './auth.store';
import { tripStore } from './trip.store';
import { bookingStore } from './booking.store';
import type { ApiUser } from '@ai-travel/shared';
import { offlineSnapshotService } from '../services/offlineSnapshot.service';
import type { Trip } from '../types/trip.types';

const user: ApiUser = {
  id: 'user-offline', name: 'Ada', email: 'ada@example.com', isGuest: false,
  createdAt: 'x', identities: [], hasPassword: true, activeTripId: 'trip-1',
  plan: 'free', proSince: null,
  settings: {
    theme: 'sharpen', currency: 'USD',
    notifications: { tripReminders: true, priceAlerts: false },
    travel: DEFAULT_SETTINGS.travel,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  authStore.reset();
  tripStore.reset();
  bookingStore.reset();
  setAccessToken(null);
  localStorage.clear();
});

describe('offline session bootstrap', () => {
  it('restores the same account in read-only mode when refresh cannot reach the server', async () => {
    storageService.set(STORAGE_KEYS.ownerUserId, user.id);
    offlineSessionService.save(user);
    const cachedTrip: Trip = {
      id: 'trip-1', title: 'Offline trip', destination: 'Lisbon', startDate: '2027-06-01',
      endDate: '2027-06-03', travellers: 2, coverImage: '', itinerary: [], createdAt: 'x', updatedAt: 'x',
    };
    offlineSnapshotService.writeTrips([cachedTrip]);
    vi.spyOn(authService, 'restore').mockRejectedValue(
      new ApiError(0, ERROR_CODES.NETWORK, 'We could not reach the server.'),
    );

    await authStore.bootstrap();

    expect(authStore.getSnapshot()).toMatchObject({ status: 'authenticated', user });
    await tripStore.refresh();
    expect(tripStore.getSnapshot().data).toEqual([cachedTrip]);
    expect(tripStore.getSnapshot().status).toBe('ready');
  });

  it('does not restore a cached profile when the server explicitly rejects the session', async () => {
    storageService.set(STORAGE_KEYS.ownerUserId, user.id);
    offlineSessionService.save(user);
    vi.spyOn(authService, 'restore').mockResolvedValue(null);

    await authStore.bootstrap();

    expect(authStore.getSnapshot()).toMatchObject({ status: 'anonymous', user: null });
  });

  it('revalidates the session and refreshes trip and booking records on reconnect', async () => {
    storageService.set(STORAGE_KEYS.ownerUserId, user.id);
    offlineSessionService.save(user);
    vi.spyOn(authService, 'login').mockResolvedValue(user);
    await authStore.signIn({ email: user.email, password: 'password' });
    vi.spyOn(authService, 'restore').mockResolvedValue(user);
    const refreshTrips = vi.spyOn(tripStore, 'refresh').mockResolvedValue();
    const refreshBookings = vi.spyOn(bookingStore, 'refresh').mockResolvedValue();

    await authStore.reconnect();

    expect(refreshTrips).toHaveBeenCalled();
    expect(refreshBookings).toHaveBeenCalled();
  });
});
