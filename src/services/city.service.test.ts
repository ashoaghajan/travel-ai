/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cityListKey, storageService } from './localStorage.service';
import { CityLookupError, cityService } from './city.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL) => implementation(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function citiesResponse(cities: string[]) {
  return jsonResponse({ error: false, msg: 'ok', data: cities });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cityService.clearCache();
});

describe('getCities', () => {
  it('returns the cities of a country, sorted', async () => {
    stubFetch(async () => citiesResponse(['Madrid', 'Barcelona', 'Alicante']));

    await expect(cityService.getCities('Spain')).resolves.toEqual([
      'Alicante',
      'Barcelona',
      'Madrid',
    ]);
  });

  it('asks for the country by name', async () => {
    const fetchMock = stubFetch(async () => citiesResponse(['Tokyo']));

    await cityService.getCities('United States');

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('country=United%20States');
  });

  it('de-duplicates names the source repeats', async () => {
    stubFetch(async () => citiesResponse(['Valencia', 'Valencia', 'Madrid']));

    await expect(cityService.getCities('Spain')).resolves.toEqual(['Madrid', 'Valencia']);
  });

  it('discards entries that are not usable names', async () => {
    stubFetch(async () => citiesResponse(['Madrid', '', '   ', 42 as unknown as string]));

    await expect(cityService.getCities('Spain')).resolves.toEqual(['Madrid']);
  });

  it('makes no request for a blank country', async () => {
    const fetchMock = stubFetch(async () => citiesResponse([]));

    await expect(cityService.getCities('  ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an empty list as a real answer', async () => {
    stubFetch(async () => citiesResponse([]));

    await expect(cityService.getCities('Antarctica')).resolves.toEqual([]);
  });
});

describe('caching', () => {
  it('caches under one key per country', async () => {
    stubFetch(async () => citiesResponse(['Madrid']));

    await cityService.getCities('Spain');

    expect(cityListKey('Spain')).toBe('ai-travel-planner:cities:Spain');
    expect(localStorage.getItem(cityListKey('Spain'))).not.toBeNull();
  });

  it('serves the second call from the cache without fetching', async () => {
    const fetchMock = stubFetch(async () => citiesResponse(['Madrid']));
    await cityService.getCities('Spain');
    fetchMock.mockClear();

    await cityService.getCities('Spain');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps each country separate', async () => {
    const fetchMock = stubFetch(async (url) =>
      citiesResponse(url.includes('Spain') ? ['Madrid'] : ['Tokyo']),
    );

    await expect(cityService.getCities('Spain')).resolves.toEqual(['Madrid']);
    await expect(cityService.getCities('Japan')).resolves.toEqual(['Tokyo']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches once the cache is a week old', async () => {
    const fetchMock = stubFetch(async () => citiesResponse(['Madrid']));
    await cityService.getCities('Spain');
    vi.setSystemTime(new Date(Date.now() + WEEK_MS + 1000));

    await cityService.getCities('Spain');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bypasses a fresh cache when asked to refresh', async () => {
    const fetchMock = stubFetch(async () => citiesResponse(['Madrid']));
    await cityService.getCities('Spain');

    await cityService.getCities('Spain', { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps only the five most recent countries', async () => {
    stubFetch(async () => citiesResponse(['A city']));

    // Each write is a minute apart so the eviction order is unambiguous.
    for (const country of ['Spain', 'Japan', 'France', 'Peru', 'Chile', 'Kenya']) {
      await cityService.getCities(country);
      vi.setSystemTime(new Date(Date.now() + 60_000));
    }

    expect(storageService.cityListKeys()).toHaveLength(5);
    // Spain was written first, so it is the one that went.
    expect(localStorage.getItem(cityListKey('Spain'))).toBeNull();
    expect(localStorage.getItem(cityListKey('Kenya'))).not.toBeNull();
  });

  it('still returns the list when the quota refuses the write', async () => {
    stubFetch(async () => citiesResponse(['Madrid']));
    vi.spyOn(storageService, 'set').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(cityService.getCities('Spain')).resolves.toEqual(['Madrid']);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchMock = stubFetch(async () => citiesResponse(['Madrid']));

    await Promise.all([cityService.getCities('Spain'), cityService.getCities('Spain')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears one country, or all of them', async () => {
    stubFetch(async () => citiesResponse(['A city']));
    await cityService.getCities('Spain');
    await cityService.getCities('Japan');

    cityService.clearCache('Spain');
    expect(localStorage.getItem(cityListKey('Spain'))).toBeNull();
    expect(localStorage.getItem(cityListKey('Japan'))).not.toBeNull();

    cityService.clearCache();
    expect(storageService.cityListKeys()).toHaveLength(0);
  });
});

describe('when the source is unavailable', () => {
  it('serves a stale copy rather than failing', async () => {
    stubFetch(async () => citiesResponse(['Madrid']));
    await cityService.getCities('Spain');

    vi.setSystemTime(new Date(Date.now() + WEEK_MS + 1000));
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(cityService.getCities('Spain')).resolves.toEqual(['Madrid']);
  });

  it('throws when there is nothing cached', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(cityService.getCities('Spain')).rejects.toThrow(CityLookupError);
  });

  it('names the country in the error', async () => {
    stubFetch(async () => jsonResponse({}, 500));

    await expect(cityService.getCities('Spain')).rejects.toThrow(/Spain/);
  });

  it('treats the source’s own error flag as a failure', async () => {
    stubFetch(async () => jsonResponse({ error: true, msg: 'country not found' }));

    await expect(cityService.getCities('Atlantis')).rejects.toThrow(CityLookupError);
  });

  it('survives a malformed response', async () => {
    stubFetch(async () => {
      const response = jsonResponse({});
      response.json = async () => {
        throw new Error('not json');
      };
      return response;
    });

    await expect(cityService.getCities('Spain')).rejects.toThrow(CityLookupError);
  });
});

describe('filter', () => {
  // Sorted, as `getCities` returns them — the filter preserves input order
  // within each bucket rather than re-sorting.
  const cities = ['Barbastro', 'Barcelona', 'Ibarra', 'Madrid', 'Seville'];

  it('ranks a prefix match above a mid-string one', () => {
    expect(cityService.filter(cities, 'bar')).toEqual(['Barbastro', 'Barcelona', 'Ibarra']);
  });

  it('ignores case and surrounding space', () => {
    expect(cityService.filter(cities, '  MADRID ')).toEqual(['Madrid']);
  });

  it('returns the head of the list for an empty query', () => {
    expect(cityService.filter(cities, '', 2)).toEqual(['Barbastro', 'Barcelona']);
  });

  it('never returns more than the limit', () => {
    const many = Array.from({ length: 500 }, (_, index) => `City ${index}`);

    expect(cityService.filter(many, 'City', 10)).toHaveLength(10);
  });

  it('returns nothing when nothing matches', () => {
    expect(cityService.filter(cities, 'zzz')).toEqual([]);
  });
});
