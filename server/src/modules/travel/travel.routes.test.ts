import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { api, errorCode } from '../../test/harness';
import { resetEnvCache } from '../../env';
import { resetAirlineTable } from './airlines';
import { resetTravelCache, resetTravelRateLimit } from './travel.routes';

/**
 * `GET /api/flights/search`.
 *
 * The provider is stubbed at `fetch`: these tests are about what the endpoint
 * does with an answer, not about Travelpayouts being up. What matters is that
 * the token never leaves the server, that a provider failure becomes something
 * the client can branch on, and that an unconfigured server says so plainly
 * rather than pretending to have prices.
 */

const SEARCH = '/api/flights/search';

const QUERY = {
  from: 'JFK',
  to: 'DPS',
  departDate: '2027-05-20',
  returnDate: '2027-05-28',
  travellers: '2',
};

/**
 * A stubbed provider that answers with these rows, wrapped in the envelope it
 * wraps everything in. Declares `fetch`'s parameters so the call log stays
 * typed — several tests assert on the URL and headers it was given.
 */
function providerAnswers(rows: unknown[]) {
  return vi.fn(
    async (_url: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, data: rows, error: null }), { status: 200 }),
  );
}

const ROW = {
  origin: 'JFK',
  destination: 'DPS',
  price: 412,
  airline: 'SU',
  flight_number: 101,
  departure_at: '2027-05-20T23:30:00-04:00',
  transfers: 1,
  duration_to: 1725,
  link: '/search/JFK2005DPS1',
};

beforeEach(() => {
  process.env.TRAVELPAYOUTS_TOKEN = 'test-token';
  process.env.TRAVELPAYOUTS_MARKER = '12345';
  resetEnvCache();
  resetTravelCache();
  resetTravelRateLimit();
  resetAirlineTable();
});

afterEach(() => {
  delete process.env.TRAVELPAYOUTS_TOKEN;
  delete process.env.TRAVELPAYOUTS_MARKER;
  resetEnvCache();
  resetTravelCache();
  resetAirlineTable();
  vi.unstubAllGlobals();
});

describe('GET /api/flights/search', () => {
  it('returns mapped fares marked as live', async () => {
    vi.stubGlobal('fetch', providerAnswers([ROW]));

    const response = await api().get(SEARCH).query(QUERY);

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('live');
    expect(response.body.quotedAt).toEqual(expect.any(String));
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0]).toMatchObject({ from: 'JFK', to: 'DPS', price: 412 });
  });

  it('sends the fare link out with the affiliate marker attached', async () => {
    vi.stubGlobal('fetch', providerAnswers([ROW]));

    const response = await api().get(SEARCH).query(QUERY);

    expect(response.body.results[0].bookingUrl).toContain('marker=12345');
  });

  /*
   * The reason this endpoint exists rather than the SPA calling the provider.
   * If the token ever appears in a response body it has been published.
   */
  it('never puts the provider token in the response', async () => {
    vi.stubGlobal('fetch', providerAnswers([ROW]));

    const response = await api().get(SEARCH).query(QUERY);

    expect(JSON.stringify(response.body)).not.toContain('test-token');
  });

  it('sends the token to the provider as a header, not in the URL', async () => {
    const fetchSpy = providerAnswers([ROW]);
    vi.stubGlobal('fetch', fetchSpy);

    await api().get(SEARCH).query(QUERY);

    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).not.toContain('test-token');
    expect((init.headers as Record<string, string>)['X-Access-Token']).toBe('test-token');
  });

  /*
   * By month, not by day. `prices_for_dates` searches a cache of fares already
   * found rather than live inventory, and that cache holds almost nothing for
   * a named day — JFK→LHR on a date returns zero rows where the same route by
   * month returns eleven. Asking by day empties the screen for most routes.
   */
  it('asks the provider for the month, not the day', async () => {
    const fetchSpy = providerAnswers([ROW]);
    vi.stubGlobal('fetch', fetchSpy);

    await api().get(SEARCH).query(QUERY);

    const [url] = fetchSpy.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/aviasales/v3/prices_for_dates');
    expect(url.searchParams.get('origin')).toBe('JFK');
    expect(url.searchParams.get('destination')).toBe('DPS');
    expect(url.searchParams.get('departure_at')).toBe('2027-05');
    expect(url.searchParams.get('return_at')).toBe('2027-05');
    expect(url.searchParams.get('one_way')).toBe('false');
    expect(url.searchParams.get('currency')).toBe('usd');
  });

  describe('narrowing to the trip', () => {
    const on = (date: string, price: number, flight = price) => ({
      ...ROW,
      flight_number: flight,
      price,
      departure_at: `${date}T09:00:00+00:00`,
    });

    // The requested day is what was asked for. If anything flies then, that is
    // the list — a cheaper fare eleven days later is a different trip.
    it('shows only the requested day when fares exist on it', async () => {
      vi.stubGlobal(
        'fetch',
        providerAnswers([on('2027-05-17', 100), on('2027-05-20', 900), on('2027-05-20', 800)]),
      );

      const response = await api().get(SEARCH).query(QUERY);

      expect(response.body.results).toHaveLength(2);
      expect(
        response.body.results.every((f: { departureDate: string }) => f.departureDate === '2027-05-20'),
      ).toBe(true);
    });

    it('orders that day cheapest first', async () => {
      vi.stubGlobal(
        'fetch',
        providerAnswers([on('2027-05-20', 900), on('2027-05-20', 300), on('2027-05-20', 600)]),
      );

      const response = await api().get(SEARCH).query(QUERY);

      expect(response.body.results.map((f: { price: number }) => f.price)).toEqual([300, 600, 900]);
    });

    /*
     * The provider's cache holds almost nothing for a named day, so an empty
     * answer would be the common case. Nearby beats nothing — and nearest
     * first, because a month ordered by price reads as a jumble.
     */
    it('falls back to nearby days, nearest first', async () => {
      vi.stubGlobal(
        'fetch',
        providerAnswers([on('2027-05-25', 100), on('2027-05-19', 700), on('2027-05-22', 400)]),
      );

      const response = await api().get(SEARCH).query(QUERY);

      expect(response.body.results.map((f: { departureDate: string }) => f.departureDate)).toEqual([
        '2027-05-19',
        '2027-05-22',
        '2027-05-25',
      ]);
    });

    it('keeps the whole month rather than answering nothing', async () => {
      vi.stubGlobal('fetch', providerAnswers([on('2027-05-01', 100), on('2027-05-31', 200)]));

      const response = await api().get(SEARCH).query(QUERY);

      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].departureDate).toBe('2027-05-31');
    });

    // The provider really does repeat itself, and a list that shows the same
    // fare twice looks broken.
    it('collapses fares the provider returned more than once', async () => {
      vi.stubGlobal(
        'fetch',
        providerAnswers([on('2027-05-20', 359, 1), on('2027-05-20', 359, 1), on('2027-05-20', 400, 2)]),
      );

      const response = await api().get(SEARCH).query(QUERY);

      expect(response.body.results).toHaveLength(2);
    });

    // Without this the card sits under a heading naming a different day.
    it('tells the client which day each fare actually departs', async () => {
      vi.stubGlobal('fetch', providerAnswers([on('2027-05-19', 100)]));

      const response = await api().get(SEARCH).query(QUERY);

      expect(response.body.results[0].departureDate).toBe('2027-05-19');
    });
  });

  describe('validation', () => {
    it('rejects an airport code that is not one', async () => {
      const response = await api().get(SEARCH).query({ ...QUERY, from: 'NOT-AN-AIRPORT' });

      expect(response.status).toBe(422);
      expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('rejects a malformed date', async () => {
      const response = await api().get(SEARCH).query({ ...QUERY, departDate: '20th May' });

      expect(response.status).toBe(422);
    });

    it('rejects an implausible party size', async () => {
      const response = await api().get(SEARCH).query({ ...QUERY, travellers: '99' });

      expect(response.status).toBe(422);
    });

    it('accepts a lower-case airport code', async () => {
      vi.stubGlobal('fetch', providerAnswers([ROW]));

      const response = await api().get(SEARCH).query({ ...QUERY, from: 'jfk' });

      expect(response.status).toBe(200);
    });
  });

  // The quota is ours to burn, so a reload loop must not spend it.
  describe('caching', () => {
    /**
     * Price lookups only. The airline-name table goes through `fetch` too, and
     * counting it here would measure the wrong thing — it is fetched once per
     * process regardless of how many searches run.
     */
    const priceCalls = (spy: ReturnType<typeof providerAnswers>) =>
      spy.mock.calls.filter(([url]) => String(url).includes('prices_for_dates')).length;

    it('serves a repeated search without calling the provider again', async () => {
      const fetchSpy = providerAnswers([ROW]);
      vi.stubGlobal('fetch', fetchSpy);

      await api().get(SEARCH).query(QUERY);
      await api().get(SEARCH).query(QUERY);

      expect(priceCalls(fetchSpy)).toBe(1);
    });

    it('treats a different search as a different search', async () => {
      const fetchSpy = providerAnswers([ROW]);
      vi.stubGlobal('fetch', fetchSpy);

      await api().get(SEARCH).query(QUERY);
      await api().get(SEARCH).query({ ...QUERY, to: 'CDG' });

      expect(priceCalls(fetchSpy)).toBe(2);
    });
  });
});
