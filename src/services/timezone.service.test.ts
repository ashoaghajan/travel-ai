/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timezoneService } from './timezone.service';
import { PlaceNotFoundError, weatherService } from './weather.service';

describe('timezoneService', () => {
  beforeEach(() => {
    localStorage.clear();
    timezoneService.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function findPlace(zones: Record<string, string | undefined>) {
    return vi.spyOn(weatherService, 'findPlace').mockImplementation(async (place: string) => {
      if (!(place in zones)) throw new PlaceNotFoundError(place);

      return {
        name: place,
        latitude: 0,
        longitude: 0,
        timezone: zones[place],
      };
    });
  }

  it('resolves a city to its zone', async () => {
    findPlace({ Tbilisi: 'Asia/Tbilisi' });

    expect(await timezoneService.locate('Tbilisi')).toBe('Asia/Tbilisi');
  });

  it('asks once for a name it has already resolved', async () => {
    const spy = findPlace({ Tbilisi: 'Asia/Tbilisi' });

    await timezoneService.locate('Tbilisi');
    await timezoneService.locate('Tbilisi');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const spy = findPlace({ Moscow: 'Europe/Moscow' });

    const [a, b] = await Promise.all([
      timezoneService.locate('Moscow'),
      timezoneService.locate('Moscow'),
    ]);

    expect([a, b]).toEqual(['Europe/Moscow', 'Europe/Moscow']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never asks about a label that is not a place', async () => {
    const spy = findPlace({});

    expect(await timezoneService.locate('Departure')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('remembers an unknown place, so a district is not asked about twice', async () => {
    const spy = findPlace({});

    await timezoneService.locate('Old Town (Abanotubani)');
    await timezoneService.locate('Old Town (Abanotubani)');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not cache a transient failure as geography', async () => {
    const spy = vi
      .spyOn(weatherService, 'findPlace')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ name: 'Tbilisi', latitude: 0, longitude: 0, timezone: 'Asia/Tbilisi' });

    expect(await timezoneService.locate('Tbilisi')).toBeNull();
    expect(await timezoneService.locate('Tbilisi')).toBe('Asia/Tbilisi');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  describe('resolveForTrip', () => {
    it('gives each destination its own zone', async () => {
      findPlace({ Tbilisi: 'Asia/Tbilisi', Moscow: 'Europe/Moscow' });

      const zoneFor = await timezoneService.resolveForTrip(['Tbilisi', 'Moscow']);

      expect(zoneFor('Tbilisi')).toBe('Asia/Tbilisi');
      expect(zoneFor('Moscow')).toBe('Europe/Moscow');
    });

    it("falls back to the trip's city for a district that does not resolve", async () => {
      findPlace({ Tbilisi: 'Asia/Tbilisi' });

      const zoneFor = await timezoneService.resolveForTrip(
        ['Sololaki & Vera', 'Old Town (Abanotubani)'],
        'Tbilisi',
      );

      expect(zoneFor('Sololaki & Vera')).toBe('Asia/Tbilisi');
      expect(zoneFor('Old Town (Abanotubani)')).toBe('Asia/Tbilisi');
    });

    it('does not spend a request on the fallback when every day resolved', async () => {
      const spy = findPlace({ Tbilisi: 'Asia/Tbilisi', Moscow: 'Europe/Moscow' });

      await timezoneService.resolveForTrip(['Tbilisi', 'Moscow'], 'Tbilisi');

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('leaves the zone undefined when neither the day nor the trip resolves', async () => {
      findPlace({});

      const zoneFor = await timezoneService.resolveForTrip(['Nowhere'], 'Also nowhere');

      expect(zoneFor('Nowhere')).toBeUndefined();
    });

    it('prefers a district that does resolve over the trip fallback', async () => {
      findPlace({ Moscow: 'Europe/Moscow', Tbilisi: 'Asia/Tbilisi' });

      const zoneFor = await timezoneService.resolveForTrip(['Moscow', 'Unknown'], 'Tbilisi');

      expect(zoneFor('Moscow')).toBe('Europe/Moscow');
      expect(zoneFor('Unknown')).toBe('Asia/Tbilisi');
    });
  });
});
