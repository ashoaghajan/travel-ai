/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CITY_LIST_KEY_PREFIX,
  STORAGE_KEYS,
  StorageWriteError,
  cityListKey,
  storageService,
} from './localStorage.service';

describe('storage keys', () => {
  it('matches the keys README specifies, plus the explorer’s own', () => {
    expect(STORAGE_KEYS).toEqual({
      trips: 'ai-travel-planner:trips',
      activeTripId: 'ai-travel-planner:activeTripId',
      chatHistory: 'ai-travel-planner:chatHistory',
      settings: 'ai-travel-planner:settings',
      recentSearches: 'ai-travel-planner:recentSearches',
      savedActivities: 'ai-travel-planner:savedActivities',
      bookings: 'ai-travel-planner:bookings',
      // Reference data, not user data: the airports the reader has picked, so
      // `partner.links.ts` can name a destination city without a round trip.
      airports: 'ai-travel-planner:airports',
      selectedCountry: 'ai-travel-planner:selectedCountry',
      selectedCity: 'ai-travel-planner:selectedCity',
      countries: 'ai-travel-planner:countries',
      activities: 'ai-travel-planner:activities',
      geocodes: 'ai-travel-planner:geocodes',
      ownerUserId: 'ai-travel-planner:ownerUserId',
    });
  });

  it('builds a city-list key per country, under a findable prefix', () => {
    expect(cityListKey('Spain')).toBe('ai-travel-planner:cities:Spain');
    expect(cityListKey('Spain').startsWith(CITY_LIST_KEY_PREFIX)).toBe(true);
  });

  it('finds every cached city list, and nothing else', () => {
    storageService.set(cityListKey('Spain'), ['Madrid']);
    storageService.set(cityListKey('Japan'), ['Tokyo']);
    storageService.set(STORAGE_KEYS.trips, []);

    expect(storageService.cityListKeys().sort()).toEqual([
      'ai-travel-planner:cities:Japan',
      'ai-travel-planner:cities:Spain',
    ]);
  });
});

describe('get', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(storageService.get(STORAGE_KEYS.trips, ['fallback'])).toEqual(['fallback']);
  });

  it('returns the parsed value', () => {
    storageService.set(STORAGE_KEYS.settings, { theme: 'dark' });
    expect(storageService.get(STORAGE_KEYS.settings, null)).toEqual({ theme: 'dark' });
  });

  it('round-trips values that JSON preserves', () => {
    const value = { a: 1, b: [true, null, 'x'], c: { nested: 'yes' } };
    storageService.set(STORAGE_KEYS.trips, value);
    expect(storageService.get(STORAGE_KEYS.trips, null)).toEqual(value);
  });

  it('falls back instead of throwing when the stored value is corrupt', () => {
    localStorage.setItem(STORAGE_KEYS.trips, '{ not json');
    expect(storageService.get(STORAGE_KEYS.trips, [])).toEqual([]);
  });
});

describe('set', () => {
  it('writes JSON under the key', () => {
    storageService.set(STORAGE_KEYS.activeTripId, 'trip_1');
    expect(localStorage.getItem(STORAGE_KEYS.activeTripId)).toBe('"trip_1"');
  });

  it('throws StorageWriteError when the browser refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => storageService.set(STORAGE_KEYS.trips, [1, 2, 3])).toThrow(StorageWriteError);
  });

  it('keeps the underlying cause on the error', () => {
    const cause = new DOMException('QuotaExceededError');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw cause;
    });

    try {
      storageService.set(STORAGE_KEYS.trips, []);
      expect.unreachable('set should have thrown');
    } catch (error) {
      expect((error as StorageWriteError).cause).toBe(cause);
    }
  });
});

describe('remove', () => {
  it('deletes the value', () => {
    storageService.set(STORAGE_KEYS.settings, { theme: 'light' });
    storageService.remove(STORAGE_KEYS.settings);
    expect(localStorage.getItem(STORAGE_KEYS.settings)).toBeNull();
  });
});

describe('subscribe', () => {
  it('notifies on writes in this tab', () => {
    const listener = vi.fn();
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, listener);

    storageService.set(STORAGE_KEYS.trips, []);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('notifies on removal', () => {
    const listener = vi.fn();
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, listener);

    storageService.remove(STORAGE_KEYS.trips);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('only notifies listeners for the key that changed', () => {
    const tripsListener = vi.fn();
    const settingsListener = vi.fn();
    const unsubscribeTrips = storageService.subscribe(STORAGE_KEYS.trips, tripsListener);
    const unsubscribeSettings = storageService.subscribe(STORAGE_KEYS.settings, settingsListener);

    storageService.set(STORAGE_KEYS.trips, []);

    expect(tripsListener).toHaveBeenCalledTimes(1);
    expect(settingsListener).not.toHaveBeenCalled();

    unsubscribeTrips();
    unsubscribeSettings();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, listener);

    unsubscribe();
    storageService.set(STORAGE_KEYS.trips, []);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies when another tab writes the key', () => {
    const listener = vi.fn();
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, listener);

    // What the browser dispatches in *other* tabs after a write.
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.trips }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('ignores storage events for other keys', () => {
    const listener = vi.fn();
    const unsubscribe = storageService.subscribe(STORAGE_KEYS.trips, listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('supports several listeners on one key', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = storageService.subscribe(STORAGE_KEYS.trips, first);
    const unsubscribeSecond = storageService.subscribe(STORAGE_KEYS.trips, second);

    storageService.set(STORAGE_KEYS.trips, []);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
  });
});

describe('usage', () => {
  it('reports every app key', () => {
    const usage = storageService.usage();
    expect(usage.map((entry) => entry.key).sort()).toEqual(Object.values(STORAGE_KEYS).sort());
  });

  it('marks untouched keys as absent and empty', () => {
    const usage = storageService.usage();
    expect(usage.every((entry) => !entry.present && entry.bytes === 0)).toBe(true);
  });

  it('measures stored values', () => {
    storageService.set(STORAGE_KEYS.settings, { theme: 'dark' });

    const settings = storageService.usage().find((entry) => entry.key === STORAGE_KEYS.settings);

    expect(settings?.present).toBe(true);
    expect(settings?.bytes).toBe(JSON.stringify({ theme: 'dark' }).length);
  });
});

describe('when storage is unavailable', () => {
  it('reads fall back instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(storageService.get(STORAGE_KEYS.trips, ['safe'])).toEqual(['safe']);
  });
});
