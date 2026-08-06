/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { CountryLookupError, countryService } from './country.service';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL) => implementation(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The shape CountriesNow returns from /countries/iso. */
function isoResponse(rows: { name: string; Iso2: string }[]) {
  return jsonResponse({ error: false, msg: 'ok', data: rows });
}

const ROWS = [
  { name: 'Spain', Iso2: 'ES' },
  { name: 'Albania', Iso2: 'AL' },
  { name: 'Japan', Iso2: 'JP' },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  countryService.clearCache();
});

describe('getCountries', () => {
  it('returns every country the source lists', async () => {
    stubFetch(async () => isoResponse(ROWS));

    await expect(countryService.getCountries()).resolves.toHaveLength(3);
  });

  it('sorts alphabetically', async () => {
    stubFetch(async () => isoResponse(ROWS));

    const countries = await countryService.getCountries();

    expect(countries.map((country) => country.name)).toEqual(['Albania', 'Japan', 'Spain']);
  });

  it('normalises the ISO code to upper case', async () => {
    stubFetch(async () => isoResponse([{ name: 'Spain', Iso2: 'es' }]));

    expect((await countryService.getCountries())[0]).toEqual({ name: 'Spain', code: 'ES' });
  });

  it('drops a row missing either half', async () => {
    stubFetch(async () =>
      isoResponse([
        { name: 'Spain', Iso2: 'ES' },
        { name: '', Iso2: 'XX' },
        { name: 'Nowhere', Iso2: '' },
        { name: 'Bad', Iso2: 'TOOLONG' },
      ] as { name: string; Iso2: string }[]),
    );

    expect(await countryService.getCountries()).toEqual([{ name: 'Spain', code: 'ES' }]);
  });

  it('caches under the documented key', async () => {
    stubFetch(async () => isoResponse(ROWS));

    await countryService.getCountries();

    expect(STORAGE_KEYS.countries).toBe('ai-travel-planner:countries');
    expect(localStorage.getItem(STORAGE_KEYS.countries)).not.toBeNull();
  });

  it('serves the second call from the cache without fetching', async () => {
    const fetchMock = stubFetch(async () => isoResponse(ROWS));
    await countryService.getCountries();
    fetchMock.mockClear();

    await countryService.getCountries();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches once the cache is a month old', async () => {
    const fetchMock = stubFetch(async () => isoResponse(ROWS));
    await countryService.getCountries();
    vi.setSystemTime(new Date(Date.now() + MONTH_MS + 1000));

    await countryService.getCountries();

    expect(fetchMock).toHaveBeenCalledTimes(1 + 1);
  });

  it('bypasses a fresh cache when asked to refresh', async () => {
    const fetchMock = stubFetch(async () => isoResponse(ROWS));
    await countryService.getCountries();

    await countryService.getCountries({ forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a cache written by an older version', async () => {
    const fetchMock = stubFetch(async () => isoResponse(ROWS));
    await countryService.getCountries();
    const cached = storageService.get<Record<string, unknown>>(STORAGE_KEYS.countries, {});
    storageService.set(STORAGE_KEYS.countries, { ...cached, version: 0 });

    await countryService.getCountries();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchMock = stubFetch(async () => isoResponse(ROWS));

    await Promise.all([countryService.getCountries(), countryService.getCountries()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('when the source is unavailable', () => {
  it('serves a stale copy rather than failing', async () => {
    stubFetch(async () => isoResponse(ROWS));
    await countryService.getCountries();

    vi.setSystemTime(new Date(Date.now() + MONTH_MS + 1000));
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(countryService.getCountries()).resolves.toHaveLength(3);
  });

  it('throws when there is nothing cached', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(countryService.getCountries()).rejects.toThrow(CountryLookupError);
  });

  it('treats an error status as a failure', async () => {
    stubFetch(async () => jsonResponse({}, 503));

    await expect(countryService.getCountries()).rejects.toThrow(CountryLookupError);
  });

  it('treats an empty list as a failure', async () => {
    stubFetch(async () => isoResponse([]));

    await expect(countryService.getCountries()).rejects.toThrow(CountryLookupError);
  });

  it('survives a malformed response', async () => {
    stubFetch(async () => {
      const response = jsonResponse({});
      response.json = async () => {
        throw new Error('not json');
      };
      return response;
    });

    await expect(countryService.getCountries()).rejects.toThrow(CountryLookupError);
  });
});

describe('lookups', () => {
  const countries = [
    { name: 'Japan', code: 'JP' },
    { name: 'Spain', code: 'ES' },
  ];

  it('finds by ISO code, case-insensitively', () => {
    expect(countryService.find(countries, 'es')).toEqual({ name: 'Spain', code: 'ES' });
  });

  it('returns null for an unknown or absent code', () => {
    expect(countryService.find(countries, 'ZZ')).toBeNull();
    expect(countryService.find(countries, null)).toBeNull();
  });

  it('finds by name, case-insensitively', () => {
    expect(countryService.findByName(countries, ' japan ')).toEqual({ name: 'Japan', code: 'JP' });
  });

  it('returns null for a name it does not know', () => {
    expect(countryService.findByName(countries, 'Atlantis')).toBeNull();
    expect(countryService.findByName(countries, undefined)).toBeNull();
    expect(countryService.findByName(countries, '  ')).toBeNull();
  });
});
