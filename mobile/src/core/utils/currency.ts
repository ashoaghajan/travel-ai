import { BASE_CURRENCY, findCurrency } from '@ai-travel/shared';
import type { Currency, CurrencyCode, ExchangeRates } from '@ai-travel/shared';

/**
 * Showing a dollar amount in the reader's currency.
 *
 * Every price in this app is quoted in USD — the flight and stay providers
 * price in dollars, and the planner's estimates are dollar guesses. Conversion
 * happens here, at the moment of display, and nowhere else. Nothing is stored
 * converted, so a rate that moves overnight can never change what a booking
 * says it cost.
 *
 * A formatter is built from a currency and a rate table rather than reading
 * either from module state. Components get theirs from `useMoney()`; pure
 * helpers take one as an argument. That is deliberate — a hidden global would
 * format correctly and then fail to re-render when the reader switched
 * currency, which is the one thing this feature has to get right.
 */

export type MoneyFormatter = {
  currency: CurrencyCode;
  /**
   * A price as a screen states it: "$15", "֏5,491", "CA$21".
   *
   * Whole units. Estimates are round numbers of dollars to begin with, and
   * carrying a converted figure to the cent would dress a guess as a
   * measurement.
   */
  format(amountInUsd: number): string;
  /**
   * A price that something else is calculated from: "$363", "$181.50",
   * "֏66,438".
   *
   * Fractions survive here because rounding would break the arithmetic on
   * screen — half of a $363 fare is $181.50, and showing it as $182 leaves a
   * reader multiplying by two and getting $364. They appear only when there
   * are any, so a whole fare stays "$363" rather than "$363.00". Currencies
   * whose minor unit is worthless round regardless, since two decimals on a
   * dram figure is noise rather than precision.
   */
  formatExact(amountInUsd: number): string;
};

/**
 * The rate table to use before the real one arrives.
 *
 * Only USD, and exactly right for it. A reader who has never switched currency
 * — most of them — therefore sees correct prices on the first paint with no
 * network round trip involved at all.
 */
export const USD_ONLY_RATES: ExchangeRates = {
  base: BASE_CURRENCY,
  rates: { USD: 1 } as ExchangeRates['rates'],
  updatedAt: '',
  isStale: false,
};

/** `Intl`'s spelling of our per-currency symbol choice. */
function currencyDisplay(currency: Currency): 'narrowSymbol' | 'symbol' {
  return currency.symbolDisplay === 'narrow' ? 'narrowSymbol' : 'symbol';
}

/**
 * Builds the two `Intl` formatters a currency needs.
 *
 * Constructing an `Intl.NumberFormat` is the expensive part of formatting, and
 * a price list renders hundreds of amounts against one currency — so they are
 * built once per formatter rather than once per amount.
 */
function intlFor(currency: Currency) {
  const display = currencyDisplay(currency);

  return {
    whole: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.code,
      currencyDisplay: display,
      maximumFractionDigits: 0,
    }),
    exact: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.code,
      currencyDisplay: display,
      // `Intl` gives the dram two decimals because the luma exists on paper.
      // At ~366 to the dollar it is worth about $0.000027, so those decimals
      // would claim a figure accurate to a thousandth of a cent.
      ...(currency.hasMeaningfulMinorUnit ? {} : { maximumFractionDigits: 0 }),
    }),
  };
}

/**
 * A formatter for one currency and one rate table.
 *
 * Falls back to the base currency when the table has no rate for the requested
 * one. That is reachable: a stored preference outlives a provider that has
 * stopped quoting a currency, and dollars are a worse answer than dram but a
 * far better one than `NaN`.
 */
export function createMoneyFormatter(
  code: CurrencyCode,
  rates: ExchangeRates = USD_ONLY_RATES,
): MoneyFormatter {
  const quoted = rates.rates[code];
  const hasRate = typeof quoted === 'number' && Number.isFinite(quoted) && quoted > 0;

  const currency = findCurrency(hasRate ? code : BASE_CURRENCY);
  const rate = hasRate ? quoted : 1;
  const format = intlFor(currency);

  return {
    currency: currency.code,
    format: (amountInUsd) => format.whole.format(amountInUsd * rate),
    formatExact: (amountInUsd) => {
      const converted = amountInUsd * rate;

      // "$363", not "$363.00" — decimals appear only when they carry something.
      return Number.isInteger(converted)
        ? format.whole.format(converted)
        : format.exact.format(converted);
    },
  };
}

/**
 * The dollar formatter.
 *
 * For the few places that state what something cost in the currency it was
 * actually charged in, rather than in the one the reader is browsing in.
 */
export const usdFormatter: MoneyFormatter = createMoneyFormatter(BASE_CURRENCY);
