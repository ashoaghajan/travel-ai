/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { Airport } from '../types/travel.types';
import { AIRPORTS } from '../mock/airports';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { airportService } from './airport.service';
import { ApiError, http } from './http';

/**
 * Airport lookup.
 *
 * Two rules run through all of this. An unreachable API must degrade to the
 * built-in eight rather than to an empty picker — the flight search has to
 * work on a fresh clone with no provider token. And an *abort* is not a
 * failure: it is the caller replacing this search with a newer one, so it must
 * reach the component rather than be swallowed into a fallback that then
 * overwrites the newer results.
 */

const YEREVAN: Airport = {
  code: 'EVN',
  city: 'Yerevan',
  name: 'Zvartnots International',
  countryCode: 'AM',
};

function apiFails(code = ERROR_CODES.INTERNAL, status = 502) {
  return vi.spyOn(http, 'get').mockRejectedValue(new ApiError(status, code, 'Nope.'));
}

function aborted() {
  return vi
    .spyOn(http, 'get')
    .mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));
}

beforeEach(() => {
  storageService.remove(STORAGE_KEYS.airports);
});

afterEach(() => {
  vi.restoreAllMocks();
  storageService.remove(STORAGE_KEYS.airports);
});

describe('search', () => {
  it('returns what the API matched', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([YEREVAN]);

    await expect(airportService.search('Yerevan')).resolves.toEqual([YEREVAN]);
  });

  it('asks for a bounded number of matches', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await airportService.search('lon');

    expect(get).toHaveBeenCalledWith('/airports', expect.objectContaining({
      query: expect.objectContaining({ q: 'lon' }),
    }));
  });

  it('makes no request for a blank query', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await expect(airportService.search('   ')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to the built-ins when the API cannot be reached', async () => {
    apiFails();

    const found = await airportService.search('London');

    // A fresh clone with no provider token still has a working flight search.
    expect(found.map((airport) => airport.code)).toEqual(['LHR']);
  });

  it('lets an abort through rather than answering it with the fallback', async () => {
    aborted();

    // The caller has already issued a newer search. Swallowing this into a
    // fallback would let a stale result overwrite the newer one.
    await expect(airportService.search('Lon')).rejects.toBeInstanceOf(DOMException);
  });
});

describe('searchOffline', () => {
  it('matches on the code', () => {
    expect(airportService.searchOffline('jfk').map((a) => a.code)).toEqual(['JFK']);
  });

  it('matches on the city', () => {
    expect(airportService.searchOffline('tokyo').map((a) => a.code)).toEqual(['HND']);
  });

  it('matches on the airport name', () => {
    expect(airportService.searchOffline('heathrow').map((a) => a.code)).toEqual(['LHR']);
  });

  it('is case-insensitive', () => {
    expect(airportService.searchOffline('DUBAI').map((a) => a.code)).toEqual(['DXB']);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(airportService.searchOffline('zzzz')).toEqual([]);
  });

  it('caps the list', () => {
    // Every built-in name contains "n" somewhere; the cap is what stops a
    // vague query filling the dropdown.
    expect(airportService.searchOffline('n').length).toBeLessThanOrEqual(8);
  });
});

describe('inCountry', () => {
  it('returns the country’s airports', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([YEREVAN]);

    await expect(airportService.inCountry('AM')).resolves.toEqual([YEREVAN]);
  });

  it('normalises the country code', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await airportService.inCountry(' am ');

    expect(get).toHaveBeenCalledWith('/airports', { query: { country: 'AM' }, signal: undefined });
  });

  it('sends the point to order by when there is one', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await airportService.inCountry('AM', { lat: 40.79, lon: 44.49 });

    // A trip to a town with no airport of its own is offered the nearest ones.
    expect(get).toHaveBeenCalledWith('/airports', {
      query: { country: 'AM', lat: 40.79, lon: 44.49 },
      signal: undefined,
    });
  });

  it('refuses anything that is not a two-letter code', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await expect(airportService.inCountry('ARM')).resolves.toEqual([]);
    await expect(airportService.inCountry('')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('answers with nothing rather than a wrong shortlist when the API fails', async () => {
    apiFails();

    // The caller falls back to the free search. Offering the built-in eight
    // here would claim they are that country's airports, which they are not.
    await expect(airportService.inCountry('AM')).resolves.toEqual([]);
  });

  it('lets an abort through', async () => {
    aborted();

    await expect(airportService.inCountry('AM')).rejects.toBeInstanceOf(DOMException);
  });
});

describe('byCode', () => {
  it('asks for the codes it was given', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([YEREVAN]);

    await airportService.byCode([' evn ', 'jfk']);

    expect(get).toHaveBeenCalledWith('/airports', { query: { codes: 'EVN,JFK' } });
  });

  it('makes no request when every code is blank', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await expect(airportService.byCode([' ', ''])).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('answers with nothing when the API fails', async () => {
    apiFails();

    // The map leaves those rows unplaced rather than failing the screen.
    await expect(airportService.byCode(['EVN'])).resolves.toEqual([]);
  });
});

describe('resolve', () => {
  it('finds a built-in', () => {
    expect(airportService.resolve('JFK')?.city).toBe('New York');
  });

  it('is case-insensitive', () => {
    expect(airportService.resolve('jfk')?.code).toBe('JFK');
  });

  it('finds one the reader picked, which is not built in', () => {
    airportService.remember(YEREVAN);

    // The whole reason `remember` exists: `partner.links.ts` is synchronous
    // and needs the *city* to build a hotel search.
    expect(airportService.resolve('EVN')?.city).toBe('Yerevan');
  });

  it('prefers a remembered airport over a built-in of the same code', () => {
    airportService.remember({ ...YEREVAN, code: 'JFK', city: 'Somewhere else' });

    expect(airportService.resolve('JFK')?.city).toBe('Somewhere else');
  });

  it('returns nothing for a code nobody knows', () => {
    expect(airportService.resolve('ZZZ')).toBeUndefined();
  });

  it('returns nothing for an empty code', () => {
    expect(airportService.resolve('')).toBeUndefined();
  });
});

describe('remember', () => {
  it('keys the airport by upper-case code', () => {
    airportService.remember({ ...YEREVAN, code: 'evn' });

    expect(airportService.resolve('EVN')?.city).toBe('Yerevan');
  });

  it('keeps the ones remembered before', () => {
    airportService.remember(YEREVAN);
    airportService.remember({ ...YEREVAN, code: 'GYD', city: 'Baku' });

    expect(airportService.resolve('EVN')?.city).toBe('Yerevan');
    expect(airportService.resolve('GYD')?.city).toBe('Baku');
  });

  it('survives storage refusing the write', () => {
    vi.spyOn(storageService, 'set').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // The picker still works; only the city lookup degrades, and it degrades
    // to the airport's own name.
    expect(() => airportService.remember(YEREVAN)).not.toThrow();
  });
});

describe('format', () => {
  it('is the field format the design specifies', () => {
    expect(airportService.format(AIRPORTS[0])).toBe('JFK - New York');
  });
});
