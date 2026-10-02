/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiUser } from '@ai-travel/shared';
import { offlineSessionService } from './offlineSession.service';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { DEFAULT_SETTINGS } from './settings.service';

const user: ApiUser = {
  id: 'user-1', name: 'Ada', email: 'ada@example.com', isGuest: false,
  createdAt: 'x', identities: [], hasPassword: true, activeTripId: 'trip-1',
  plan: 'free', proSince: null,
  settings: {
    theme: 'sharpen', currency: 'USD',
    notifications: { tripReminders: true, priceAlerts: false },
    travel: DEFAULT_SETTINGS.travel,
  },
};

afterEach(() => storageService.remove(STORAGE_KEYS.offlineUser));

describe('offlineSessionService', () => {
  it('returns a cached profile only to the owning account', () => {
    offlineSessionService.save(user);
    expect(offlineSessionService.read('user-1')).toEqual(user);
    expect(offlineSessionService.read('user-2')).toBeNull();
    expect(offlineSessionService.read(null)).toBeNull();
  });
});
