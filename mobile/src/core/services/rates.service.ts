import { BASE_CURRENCY, isCurrencyCode } from '@ai-travel/shared';
import type { CurrencyCode, ExchangeRates } from '@ai-travel/shared';
import { http } from './http';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Exchange rates, as the SPA holds them.
 *
 * No React component may import this file.
 *
 * Two layers, for two different problems. The API's own cache stops the
 * provider being asked more than a few times a day; the local copy here stops
 * a *reload* being a visible event — without it, a reader who browses in dram
 * would watch every price on the page start in dollars and change a moment
 * later, which reads as the preference having been forgotten.
 *
 * Rates are reference data, not user data: nothing here is archived when an
 * account signs out, and a stale copy is shared happily between accounts.
 */

/**
 * How long a stored copy is served before refreshing.
 *
 * The server republishes every six hours at most, so matching that is already
 * as often as the numbers can change.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Bump to invalidate every cached copy after a shape change. */
const CACHE_VERSION = 1;

type RatesCache = {
  version: number;
  /** When *we* stored it — distinct from the provider's `updatedAt`. */
  fetchedAt: string;
  rates: ExchangeRates;
};

function isFresh(cache: RatesCache | null): cache is RatesCache {
  if (!cache || cache.version !== CACHE_VERSION) return false;

  const age = Date.now() - Date.parse(cache.fetchedAt);

  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

/**
 * Enough of a rate table to be usable, or null.
 *
 * A partial table is treated as no table. Every price on a screen is formatted
 * through the same rates, so one missing entry is not a degraded experience
 * for one currency — it is the reader's chosen currency silently reverting to
 * dollars.
 */
function toRates(payload: unknown): ExchangeRates | null {
  if (!payload || typeof payload !== 'object') return null;

  const body = payload as Partial<ExchangeRates>;
  if (body.base !== BASE_CURRENCY || !body.rates || typeof body.rates !== 'object') return null;

  const rates = {} as Record<CurrencyCode, number>;

  for (const [code, rate] of Object.entries(body.rates)) {
    if (isCurrencyCode(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      rates[code] = rate;
    }
  }

  if (!rates[BASE_CURRENCY]) return null;

  return {
    base: BASE_CURRENCY,
    rates,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : '',
    isStale: body.isStale === true,
  };
}

function readCache(): ExchangeRates | null {
  const cache = storageService.get<RatesCache | null>(STORAGE_KEYS.exchangeRates, null);

  return isFresh(cache) ? toRates(cache.rates) : null;
}

function writeCache(rates: ExchangeRates): void {
  try {
    storageService.set<RatesCache>(STORAGE_KEYS.exchangeRates, {
      version: CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      rates,
    });
  } catch {
    // Full or blocked storage. Rates are a cache, not a record — losing the
    // write costs a fetch on the next load and nothing else.
  }
}

export const ratesService = {
  /**
   * The cached table, synchronously.
   *
   * This is what the first paint uses, which is the whole reason the local
   * copy exists. Null when nothing has been stored, or when what was stored
   * has aged out.
   */
  readSync(): ExchangeRates | null {
    return readCache();
  },

  /**
   * Fresh rates, from cache when they are current and from the API when not.
   *
   * Never throws. A reader whose rates could not be refreshed keeps whatever
   * was cached, and one who has none sees dollars — both of which are prices
   * on a screen, which is what the caller needs. The alternative, an error
   * state on every priced surface in the app because a currency table is a few
   * hours old, would be wildly out of proportion.
   */
  async load(signal?: AbortSignal): Promise<ExchangeRates | null> {
    const cached = readCache();
    if (cached) return cached;

    try {
      const rates = toRates(await http.get<ExchangeRates>('/rates', { signal }));
      if (!rates) return readStaleCache();

      writeCache(rates);

      return rates;
    } catch {
      return readStaleCache();
    }
  },
};

/**
 * The stored table regardless of age.
 *
 * Only reached when a refresh has already failed. At that point "yesterday's
 * rates" beats "no rates" by a wide margin — the numbers move by a fraction of
 * a percent a day, whereas falling back to dollars changes every figure on the
 * screen by the whole exchange rate.
 */
function readStaleCache(): ExchangeRates | null {
  const cache = storageService.get<RatesCache | null>(STORAGE_KEYS.exchangeRates, null);

  if (!cache || cache.version !== CACHE_VERSION) return null;

  const rates = toRates(cache.rates);

  return rates ? { ...rates, isStale: true } : null;
}
