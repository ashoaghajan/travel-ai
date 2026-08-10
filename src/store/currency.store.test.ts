/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExchangeRates } from '@ai-travel/shared';
import { STORAGE_KEYS, storageService } from '../services/localStorage.service';
import { ratesService } from '../services/rates.service';
import { resetCurrencyStore, setDisplayCurrency, useMoney } from './currency.store';

/**
 * Switching currency, and the two ways that can go wrong.
 *
 * The formatting itself is covered in `utils/currency.test.ts`. What matters
 * here is the wiring: that a switch actually reaches a component that has
 * already rendered, and that a component asking for a formatter does not
 * quietly become a component asking for the rate table.
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

beforeEach(() => {
  storageService.remove(STORAGE_KEYS.settings);
  storageService.remove(STORAGE_KEYS.exchangeRates);
  resetCurrencyStore();
  vi.spyOn(ratesService, 'readSync').mockReturnValue(null);
  vi.spyOn(ratesService, 'load').mockResolvedValue(RATES);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCurrencyStore();
});

describe('useMoney', () => {
  it('starts in dollars before any rates have loaded', () => {
    const { result } = renderHook(() => useMoney());

    expect(result.current.format(15)).toBe('$15');
  });

  it('re-renders a mounted component when the currency changes', async () => {
    const { result } = renderHook(() => useMoney());

    await waitFor(() => expect(result.current.currency).toBe('USD'));

    act(() => setDisplayCurrency('AMD'));

    // The whole point of the store. A formatter read from module state would
    // convert correctly here and never reach the screen.
    await waitFor(() => expect(result.current.format(15)).toBe('֏5,491'));
  });

  it('loads the rate table once however many components ask', async () => {
    const first = renderHook(() => useMoney());
    const second = renderHook(() => useMoney());
    const third = renderHook(() => useMoney());

    await waitFor(() => expect(first.result.current.currency).toBe('USD'));

    // Rates change daily. A priced screen mounts dozens of cards, and one
    // fetch each would be dozens of requests for one day-old number.
    expect(ratesService.load).toHaveBeenCalledTimes(1);

    second.unmount();
    third.unmount();
  });

  it('keeps showing prices when the rates never arrive', async () => {
    vi.spyOn(ratesService, 'load').mockResolvedValue(null);

    const { result } = renderHook(() => useMoney());

    act(() => setDisplayCurrency('AMD'));

    // Dollars under a dram preference is wrong, but an error state on every
    // priced surface in the app because a currency table is unavailable would
    // be wildly out of proportion.
    await waitFor(() => expect(result.current.format(15)).toBe('$15'));
  });

  it('carries the choice across a reload', async () => {
    const first = renderHook(() => useMoney());
    act(() => setDisplayCurrency('EUR'));
    await waitFor(() => expect(first.result.current.currency).toBe('EUR'));
    first.unmount();

    // A fresh store over the same storage — what a page reload amounts to.
    // The cached table is in place first, because on a real reload it is
    // already in storage before the module initialises.
    vi.spyOn(ratesService, 'readSync').mockReturnValue(RATES);
    resetCurrencyStore();

    const second = renderHook(() => useMoney());

    expect(second.result.current.format(15)).toBe('€13');
  });
});
