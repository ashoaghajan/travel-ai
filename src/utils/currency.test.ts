import { describe, expect, it } from 'vitest';
import type { ExchangeRates } from '@ai-travel/shared';
import { createMoneyFormatter, USD_ONLY_RATES } from './currency';

/**
 * What a price looks like once converted.
 *
 * The interesting cases are not the arithmetic — that is one multiplication —
 * but the presentation decisions around it: a Canadian dollar that must not
 * look like a US one, a dram that must not be quoted to the hundredth, and a
 * missing rate that must not reach the screen as `NaN`.
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

describe('createMoneyFormatter', () => {
  it('converts and rounds an estimate to whole units', () => {
    expect(createMoneyFormatter('USD', RATES).format(15)).toBe('$15');
    expect(createMoneyFormatter('AMD', RATES).format(15)).toBe('֏5,491');
    expect(createMoneyFormatter('EUR', RATES).format(15)).toBe('€13');
  });

  it('distinguishes the dollar currencies from each other', () => {
    // The narrow symbol for both of these is a bare "$". Beside a US total,
    // that is not a formatting nit — it is a different amount of money.
    expect(createMoneyFormatter('CAD', RATES).format(15)).toBe('CA$21');
    expect(createMoneyFormatter('AUD', RATES).format(15)).toBe('A$23');
    expect(createMoneyFormatter('USD', RATES).format(15)).toBe('$15');
  });

  it('gives the dram its own sign rather than its letters', () => {
    expect(createMoneyFormatter('AMD', RATES).format(15)).toContain('֏');
  });

  it('shows cents on a unit price only when there are any', () => {
    const usd = createMoneyFormatter('USD', RATES);

    // Half of a $363 fare. Rounding it to $182 leaves a reader doubling it and
    // getting $364, which reads as an error in the total.
    expect(usd.formatExact(181.5)).toBe('$181.50');
    expect(usd.formatExact(363)).toBe('$363');
  });

  it('does not quote a dram amount to the hundredth', () => {
    // A luma is worth about $0.000027. Two decimals here would claim a figure
    // accurate to a thousandth of a cent.
    const amd = createMoneyFormatter('AMD', RATES).formatExact(181.5);

    expect(amd).toBe('֏66,438');
    expect(amd).not.toContain('.');
  });

  it('falls back to dollars when the table does not quote the currency', () => {
    // Reachable: a stored preference outlives a provider that stopped quoting
    // it. Dollars are a worse answer than dram and a much better one than NaN.
    const formatter = createMoneyFormatter('AMD', USD_ONLY_RATES);

    expect(formatter.currency).toBe('USD');
    expect(formatter.format(15)).toBe('$15');
  });

  it('prices correctly before any rates have loaded', () => {
    // The first paint, every time. USD is the default and the base, so it is
    // exactly right with no network round trip.
    expect(createMoneyFormatter('USD').format(2248)).toBe('$2,248');
  });
});
