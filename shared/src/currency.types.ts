/**
 * Display currencies, and the rates `GET /api/rates` answers with.
 *
 * Prices in this app are quoted in USD and only ever *shown* in something
 * else: the flight and stay providers price in dollars, and the planner's
 * estimates are dollar guesses. So there is one base currency, conversion is
 * a presentation step, and nothing is stored converted. A rate that moves
 * overnight must never change what a booking says it cost.
 *
 * The table lives in `shared` because both sides need it and neither owns it —
 * the server narrows the provider's ~160 currencies down to this list, and the
 * SPA builds its picker from the same rows.
 */

export const BASE_CURRENCY = 'USD';

export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'AED'
  | 'AMD'
  | 'JPY'
  | 'CHF'
  | 'CAD'
  | 'AUD';

export type Currency = {
  code: CurrencyCode;
  /** Shown beside the code in the picker, e.g. "Armenian Dram". */
  name: string;
  /**
   * Which `Intl` currency symbol to use.
   *
   * `narrow` is the prettier choice and mostly the right one, but it is not
   * safe by default: it renders both CAD and AUD as a bare "$", which beside a
   * USD total is not a formatting nit but a wrong number. The wide form gives
   * "CA$" and "A$" there. The dram is the opposite case — the wide form is the
   * letters "AMD" and only the narrow form is "֏" — so this is per currency.
   */
  symbolDisplay: 'narrow' | 'wide';
  /**
   * Whether a fraction of a unit is worth showing.
   *
   * Two decimals on a dram amount is false precision dressed as accuracy: at
   * ~366 to the dollar a luma is worth about $0.000027, so "֏66,438.08" claims
   * to place a figure to within a thousandth of a cent. Currencies whose unit
   * is small enough for the minor unit to be meaningless are formatted whole
   * even where `Intl` would give them decimals.
   */
  hasMeaningfulMinorUnit: boolean;
};

/**
 * The offered currencies, in the order the picker lists them.
 *
 * USD first because it is the base and the default; then the ones a traveller
 * using this app is most likely to want to read.
 */
export const CURRENCIES: readonly Currency[] = [
  { code: 'USD', name: 'US Dollar', symbolDisplay: 'narrow', hasMeaningfulMinorUnit: true },
  { code: 'EUR', name: 'Euro', symbolDisplay: 'narrow', hasMeaningfulMinorUnit: true },
  { code: 'GBP', name: 'British Pound', symbolDisplay: 'narrow', hasMeaningfulMinorUnit: true },
  { code: 'AED', name: 'UAE Dirham', symbolDisplay: 'wide', hasMeaningfulMinorUnit: true },
  { code: 'AMD', name: 'Armenian Dram', symbolDisplay: 'narrow', hasMeaningfulMinorUnit: false },
  { code: 'JPY', name: 'Japanese Yen', symbolDisplay: 'narrow', hasMeaningfulMinorUnit: false },
  { code: 'CHF', name: 'Swiss Franc', symbolDisplay: 'wide', hasMeaningfulMinorUnit: true },
  { code: 'CAD', name: 'Canadian Dollar', symbolDisplay: 'wide', hasMeaningfulMinorUnit: true },
  { code: 'AUD', name: 'Australian Dollar', symbolDisplay: 'wide', hasMeaningfulMinorUnit: true },
] as const;

export const CURRENCY_CODES: readonly CurrencyCode[] = CURRENCIES.map((entry) => entry.code);

/** Narrows an unknown string — a stored preference, a query parameter. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_CODES.includes(value as CurrencyCode);
}

export function findCurrency(code: CurrencyCode): Currency {
  const currency = CURRENCIES.find((entry) => entry.code === code);

  // Unreachable through the type, but this is also the landing point for a
  // hand-edited stored preference that got past `isCurrencyCode`.
  return currency ?? CURRENCIES[0];
}

/**
 * What one US dollar buys, per currency — `GET /api/rates`.
 *
 * `USD: 1` is present rather than implied, so a formatter can look up its rate
 * without special-casing the base.
 */
export type ExchangeRates = {
  base: typeof BASE_CURRENCY;
  rates: Record<CurrencyCode, number>;
  /**
   * ISO timestamp of the provider's last update, not of our fetch.
   *
   * The distinction matters on screen: rates refresh once a day, so a reader
   * told "updated 2 minutes ago" when we merely re-read a day-old table is
   * being told something false.
   */
  updatedAt: string;
  /**
   * True when the provider could not be reached and these are the last rates
   * we held. The screen can then say so instead of quietly showing stale
   * numbers as current ones.
   */
  isStale: boolean;
};
