import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENCY_CODES } from '@ai-travel/shared';
import { api } from '../../test/harness';
import { resetRatesCache } from './exchange';

/**
 * `GET /api/rates`.
 *
 * The provider is stubbed at `fetch`. What these tests care about is the
 * behaviour a reader actually feels: that the table is complete enough to
 * price a screen, that one process does not re-fetch a daily figure per
 * request, and above all that a provider outage leaves prices on the screen
 * rather than blanking them.
 */

const RATES = '/api/rates';

/** The provider's shape, with every offered currency quoted. */
function providerBody(overrides: Record<string, number> = {}) {
  return {
    result: 'success',
    time_last_update_unix: 1_786_320_151,
    rates: {
      USD: 1,
      EUR: 0.865507,
      GBP: 0.741549,
      AED: 3.6725,
      AMD: 366.050039,
      JPY: 157.880961,
      CHF: 0.79,
      CAD: 1.37,
      AUD: 1.51,
      ...overrides,
    },
  };
}

function providerAnswers(body: unknown = providerBody(), status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  resetRatesCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRatesCache();
});

describe('GET /api/rates', () => {
  it('quotes every currency the picker offers', async () => {
    vi.stubGlobal('fetch', providerAnswers());

    const response = await api().get(RATES).expect(200);

    expect(response.body.base).toBe('USD');
    expect(Object.keys(response.body.rates).sort()).toEqual([...CURRENCY_CODES].sort());
    expect(response.body.rates.AMD).toBeCloseTo(366.05);
    expect(response.body.isStale).toBe(false);
  });

  it('reports the provider’s publication time, not the time of our fetch', async () => {
    vi.stubGlobal('fetch', providerAnswers());

    const response = await api().get(RATES).expect(200);

    // Rates refresh daily. Timestamping the response with `now` would tell a
    // reader the numbers are seconds old when they may be most of a day old.
    expect(response.body.updatedAt).toBe(new Date(1_786_320_151 * 1000).toISOString());
  });

  it('serves a second request from memory', async () => {
    const provider = providerAnswers();
    vi.stubGlobal('fetch', provider);

    await api().get(RATES).expect(200);
    await api().get(RATES).expect(200);

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('asks the provider once when several requests arrive on a cold cache', async () => {
    const provider = providerAnswers();
    vi.stubGlobal('fetch', provider);

    await Promise.all([api().get(RATES), api().get(RATES), api().get(RATES)]);

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the last rates when the provider goes down', async () => {
    vi.stubGlobal('fetch', providerAnswers());
    await api().get(RATES).expect(200);

    // Expire the held table so the next request has to go upstream, then take
    // the provider away underneath it. `Date.now` is moved rather than the
    // whole clock faked, so supertest's own sockets keep working.
    const sevenHoursOn = Date.now() + 7 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(sevenHoursOn);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const response = await api().get(RATES).expect(200);

    // Yesterday's rates differ from today's by a fraction of a percent. A blank
    // price column differs from a priced one by the whole screen.
    expect(response.body.rates.AMD).toBeCloseTo(366.05);
    expect(response.body.isStale).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');

    clock.mockRestore();
  });

  it('fails when the provider is down and nothing was ever cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await api().get(RATES).expect(502);
  });

  it('refuses a table missing a currency the picker offers', async () => {
    const incomplete = providerBody();
    delete (incomplete.rates as Record<string, number>).AMD;
    vi.stubGlobal('fetch', providerAnswers(incomplete));

    // Serving this would put a dram option in the picker that renders every
    // price as NaN, which is worse than saying the rates are unavailable.
    await api().get(RATES).expect(502);
  });

  it('lets a fresh table be cached by anything in between', async () => {
    vi.stubGlobal('fetch', providerAnswers());

    const response = await api().get(RATES).expect(200);

    expect(response.headers['cache-control']).toContain('public');
  });
});
