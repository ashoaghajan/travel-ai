import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { airportsByCode, resetAirportDirectory, searchAirports } from './airports';

/**
 * The airport directory.
 *
 * Ranking is the whole job here: 3,673 airports means the right one has to
 * come first, not merely be somewhere in the list. The provider's two data
 * files are stubbed so these tests describe our behaviour rather than theirs.
 */

const AIRPORTS = [
  { code: 'MXP', name: 'Milano Malpensa Airport', city_code: 'MIL', country_code: 'IT', flightable: true, iata_type: 'airport' },
  { code: 'LIN', name: 'Milano Linate Airport', city_code: 'MIL', country_code: 'IT', flightable: true, iata_type: 'airport' },
  { code: 'XIK', name: 'Milan Centrale Railway Station', city_code: 'MIL', country_code: 'IT', flightable: true, iata_type: 'railway' },
  { code: 'LHR', name: 'London Heathrow Airport', city_code: 'LON', country_code: 'GB', flightable: true, iata_type: 'airport' },
  { code: 'LDZ', name: 'Londolozi Airport', city_code: 'LDZ', country_code: 'ZA', flightable: true, iata_type: 'airport' },
  { code: 'JFK', name: 'John F. Kennedy International Airport', city_code: 'NYC', country_code: 'US', flightable: true, iata_type: 'airport' },
  { code: 'ZZZ', name: 'Closed Field', city_code: 'NYC', country_code: 'US', flightable: false, iata_type: 'airport' },
];

const CITIES = [
  { code: 'MIL', name: 'Milan' },
  { code: 'LON', name: 'London' },
  { code: 'LDZ', name: 'Londolozi' },
  { code: 'NYC', name: 'New York' },
];

function stubProvider() {
  return vi.fn(async (url: URL | string) =>
    String(url).includes('cities')
      ? new Response(JSON.stringify(CITIES), { status: 200 })
      : new Response(JSON.stringify(AIRPORTS), { status: 200 }),
  );
}

beforeEach(() => {
  resetAirportDirectory();
  vi.stubGlobal('fetch', stubProvider());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAirportDirectory();
});

describe('searchAirports', () => {
  it('finds an airport by its city', async () => {
    const found = await searchAirports('milan', 10);

    expect(found.map((a) => a.code)).toContain('MXP');
  });

  /*
   * The city comes from the second file. Without that join the hotel and
   * activity deep links would search for "Milano Malpensa Airport" — see
   * `partner.links.ts`, which needs somewhere a person can sleep.
   */
  it('names the city the airport serves, not the airport', async () => {
    const [first] = await searchAirports('MXP', 10);

    expect(first.city).toBe('Milan');
    expect(first.name).toBe('Milano Malpensa Airport');
  });

  it('puts an exact code match first', async () => {
    const found = await searchAirports('jfk', 10);

    expect(found[0].code).toBe('JFK');
  });

  // Alphabetical order gets this backwards, and "lon" is overwhelmingly London.
  it('prefers the closer city match over the alphabetically earlier one', async () => {
    const found = await searchAirports('lon', 10);

    expect(found[0].code).toBe('LHR');
  });

  it('is case- and accent-insensitive', async () => {
    expect((await searchAirports('MILÁN', 10)).length).toBeGreaterThan(0);
  });

  // `flightable` is true for Milan's railway stations, which would otherwise
  // outnumber its airports in a search for "milan".
  it('offers airports only, not railway stations', async () => {
    const found = await searchAirports('milan', 10);

    expect(found.map((a) => a.code)).not.toContain('XIK');
  });

  it('leaves out places nothing departs from', async () => {
    const found = await searchAirports('closed', 10);

    expect(found).toEqual([]);
  });

  it('respects the limit', async () => {
    expect(await searchAirports('a', 2)).toHaveLength(2);
  });

  it('answers an empty query with nothing rather than everything', async () => {
    expect(await searchAirports('', 10)).toEqual([]);
    expect(await searchAirports('   ', 10)).toEqual([]);
  });

  it('loads the two files once, however many searches run', async () => {
    await searchAirports('milan', 5);
    await searchAirports('london', 5);
    await searchAirports('jfk', 5);

    // One airports file, one cities file.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  // A directory that cannot be fetched must not take the flight search with
  // it — the client falls back to its own built-in eight.
  it('degrades to an empty directory when the provider is unreachable', async () => {
    resetAirportDirectory();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );

    expect(await searchAirports('milan', 10)).toEqual([]);
  });
});

describe('airportsByCode', () => {
  it('resolves the codes it is given', async () => {
    const found = await airportsByCode(['JFK', 'LHR']);

    expect(found.map((a) => a.code).sort()).toEqual(['JFK', 'LHR']);
  });

  it('ignores casing', async () => {
    expect(await airportsByCode(['jfk'])).toHaveLength(1);
  });

  it('skips codes it does not know', async () => {
    expect(await airportsByCode(['JFK', 'NOPE'])).toHaveLength(1);
  });

  it('answers nothing for no codes', async () => {
    expect(await airportsByCode([])).toEqual([]);
  });
});
