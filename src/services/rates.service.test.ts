/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExchangeRates } from '@ai-travel/shared';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { ratesService } from './rates.service';

/**
 * The exchange-rate cache.
 *
 * Two behaviours here are the difference between a currency preference that
 * looks solid and one that looks broken. The stored copy is what the first
 * paint uses — without it a reader who browses in dram watches every price
 * start in dollars and change a moment later, which reads as the preference
 * having been forgotten. And a refresh that fails must fall back to whatever
 * was stored, however old: yesterday's rates differ from today's by a fraction
 * of a percent, where falling back to dollars changes every figure on screen
 * by the whole exchange rate.
 */

const RATES: ExchangeRates = {
  base: 'USD',
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
  },
  updatedAt: '2026-08-10T00:02:31.000Z',
  isStale: false,
};

const HOUR_MS = 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function stubFetch(implementation: () => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** What the service writes: the table plus when we stored it. */
function seedCache(rates: ExchangeRates, fetchedAt = new Date().toISOString()) {
  storageService.set(STORAGE_KEYS.exchangeRates, { version: 1, fetchedAt, rates });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-10T10:00:00Z'));
  storageService.remove(STORAGE_KEYS.exchangeRates);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  storageService.remove(STORAGE_KEYS.exchangeRates);
});

describe('readSync', () => {
  it('returns nothing when nothing is stored', () => {
    expect(ratesService.readSync()).toBeNull();
  });

  it('returns a fresh stored table', () => {
    seedCache(RATES);

    expect(ratesService.readSync()?.rates.AMD).toBeCloseTo(366.05);
  });

  it('ignores a table older than the hold', () => {
    seedCache(RATES, new Date(Date.now() - 7 * HOUR_MS).toISOString());

    expect(ratesService.readSync()).toBeNull();
  });

  it('ignores a table written by an older version', () => {
    storageService.set(STORAGE_KEYS.exchangeRates, {
      version: 0,
      fetchedAt: new Date().toISOString(),
      rates: RATES,
    });

    expect(ratesService.readSync()).toBeNull();
  });

  it('ignores a table with no base rate', () => {
    // Without USD every conversion divides by nothing; a partial table is no
    // table, because one missing entry silently reverts the chosen currency.
    seedCache({ ...RATES, rates: { EUR: 0.86 } as ExchangeRates['rates'] });

    expect(ratesService.readSync()).toBeNull();
  });
});

describe('load', () => {
  it('serves a fresh cache without asking the API', async () => {
    seedCache(RATES);
    const fetchMock = stubFetch(async () => jsonResponse(RATES));

    await expect(ratesService.load()).resolves.toMatchObject({ base: 'USD' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and stores when nothing is cached', async () => {
    stubFetch(async () => jsonResponse(RATES));

    const loaded = await ratesService.load();

    expect(loaded?.rates.AED).toBeCloseTo(3.6725);
    expect(ratesService.readSync()?.rates.AED).toBeCloseTo(3.6725);
  });

  it('drops currencies the table does not quote properly', async () => {
    stubFetch(async () =>
      jsonResponse({ ...RATES, rates: { USD: 1, EUR: 0.86, AMD: 0, GBP: 'nope', XXX: 5 } }),
    );

    const loaded = await ratesService.load();

    // A zero or non-numeric rate renders every price as 0 or NaN; an unknown
    // code is not offered by the picker and has nothing to convert.
    expect(Object.keys(loaded?.rates ?? {}).sort()).toEqual(['EUR', 'USD']);
  });

  it('falls back to a stale copy when the API fails', async () => {
    seedCache(RATES, new Date(Date.now() - 7 * HOUR_MS).toISOString());
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const loaded = await ratesService.load();

    expect(loaded?.rates.AMD).toBeCloseTo(366.05);
    expect(loaded?.isStale).toBe(true);
  });

  it('falls back to a stale copy when the API answers with nonsense', async () => {
    seedCache(RATES, new Date(Date.now() - 7 * HOUR_MS).toISOString());
    stubFetch(async () => jsonResponse({ base: 'EUR' }));

    const loaded = await ratesService.load();

    expect(loaded?.isStale).toBe(true);
  });

  it('returns nothing when it fails with nothing cached', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    // Never throws: a reader with no rates sees dollars, which is still a
    // price on a screen. An error state on every priced surface because a
    // currency table is unavailable would be out of proportion.
    await expect(ratesService.load()).resolves.toBeNull();
  });

  it('survives storage refusing the write', async () => {
    stubFetch(async () => jsonResponse(RATES));
    vi.spyOn(storageService, 'set').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // Rates are a cache, not a record — losing the write costs one fetch.
    await expect(ratesService.load()).resolves.toMatchObject({ base: 'USD' });
  });
});
