import { BASE_CURRENCY, CURRENCY_CODES, ERROR_CODES } from '@ai-travel/shared';
import type { CurrencyCode, ExchangeRates } from '@ai-travel/shared';
import { HttpError } from '../../errors';

/**
 * Where exchange rates come from.
 *
 * The provider's open endpoint needs no key and no account, which is why it is
 * called from the server anyway: not to hide a secret, but so that one process
 * holds one copy of a table that every reader would otherwise fetch for
 * themselves. Rates move once a day; a thousand readers pulling them per page
 * view would be a thousand requests for the same numbers.
 */

const PROVIDER_URL = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`;

/**
 * How long a fetched table counts as current.
 *
 * The provider republishes daily, so anything under a day is already more
 * often than the data changes. Six hours means a deploy or a restart lands on
 * fresh numbers within a quarter of a day without polling for no reason.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

/** Provider shape, narrowed to the fields this module reads. */
type ProviderResponse = {
  result: string;
  time_last_update_unix: number;
  rates: Record<string, number>;
};

/**
 * The last table we successfully fetched, kept indefinitely.
 *
 * Separate from any TTL, and deliberately never cleared. If the provider is
 * down, yesterday's rates are a far better answer than none: the difference
 * between them and today's is a fraction of a percent, whereas the difference
 * between showing a price and showing nothing is the whole screen. Staleness
 * is reported rather than hidden — see `isStale` on the response.
 */
let lastGood: ExchangeRates | null = null;
let expiresAt = 0;

/**
 * The fetch currently in flight, if any.
 *
 * Without this, a cold start under load fires one upstream request per
 * incoming request. They all want the identical table, so they can all wait on
 * the first one.
 */
let inFlight: Promise<ExchangeRates> | null = null;

/** Every offered currency, or an explanation of which one the provider omitted. */
function toRates(body: ProviderResponse): Record<CurrencyCode, number> {
  const rates = {} as Record<CurrencyCode, number>;

  for (const code of CURRENCY_CODES) {
    const rate = body.rates[code];

    // A currency in the picker with no rate behind it would render every price
    // as `NaN`, so an incomplete table is treated as no table at all.
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new HttpError(
        502,
        ERROR_CODES.INTERNAL,
        `Our rates partner did not quote ${code}.`,
      );
    }

    rates[code] = rate;
  }

  return rates;
}

/**
 * How long to wait on the provider before giving up.
 *
 * Needed because the fetch below deliberately carries no caller's abort
 * signal, so nothing else would ever cancel it: a provider that accepts the
 * connection and then stalls would otherwise pin `inFlight` forever and every
 * later request would queue behind it.
 */
const PROVIDER_TIMEOUT_MS = 8000;

/**
 * One request to the provider, owned by the process rather than by a caller.
 *
 * No caller's `AbortSignal` reaches here on purpose. This promise is shared by
 * everyone who asked while it was in flight, so honouring one request's
 * cancellation — a reader closing a tab — would abort the fetch that all the
 * others are waiting on.
 */
async function fetchFromProvider(): Promise<ExchangeRates> {
  let response: Response;

  try {
    response = await fetch(PROVIDER_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new HttpError(
      502,
      ERROR_CODES.INTERNAL,
      'We could not reach our rates partner.',
      cause instanceof Error ? cause.message : null,
    );
  }

  if (!response.ok) {
    throw new HttpError(502, ERROR_CODES.INTERNAL, 'Our rates partner returned an error.');
  }

  const body = (await response.json()) as ProviderResponse;

  if (body.result !== 'success' || !body.rates) {
    throw new HttpError(502, ERROR_CODES.INTERNAL, 'Our rates partner returned an error.');
  }

  return {
    base: BASE_CURRENCY,
    rates: toRates(body),
    // The provider's own publication time, not ours. `time_last_update_unix`
    // is seconds; `Date` wants milliseconds.
    updatedAt: new Date(body.time_last_update_unix * 1000).toISOString(),
    isStale: false,
  };
}

/**
 * Rates, from cache when they are current and from the provider when not.
 *
 * Only throws when there is genuinely nothing to say — the provider failed and
 * this process has never held a table. Once it has held one, this resolves
 * forever.
 */
export async function getRates(): Promise<ExchangeRates> {
  if (lastGood && Date.now() < expiresAt) return lastGood;

  inFlight ??= fetchFromProvider()
    .then((rates) => {
      lastGood = rates;
      expiresAt = Date.now() + TTL_MS;

      return rates;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    if (lastGood) return { ...lastGood, isStale: true };

    throw error;
  }
}

/** Test seam: drops both the cache and the stale fallback. */
export function resetRatesCache(): void {
  lastGood = null;
  expiresAt = 0;
  inFlight = null;
}
