import { useEffect, useSyncExternalStore } from 'react';
import type { CurrencyCode, ExchangeRates } from '@ai-travel/shared';
import { ratesService } from '../services/rates.service';
import { settingsService } from '../services/settings.service';
import { createMoneyFormatter } from '../utils/currency';
import type { MoneyFormatter } from '../utils/currency';

/**
 * The currency prices are shown in, and the rates behind it.
 *
 * Components read through `useMoney()` and write through `setDisplayCurrency`.
 * Both halves live in one store because a formatter needs both, and a screen
 * that had the preference but not yet the rates would show dram prices at
 * dollar figures — briefly, and wrongly.
 *
 * The rate table is fetched once per session, not per component. Rates change
 * daily; a hook that fetched on mount would ask again for every priced card on
 * a busy screen.
 */

let rates: ExchangeRates | null = ratesService.readSync();

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // The preference and the rates change independently — a reader picking dram
  // in Settings, and the day's table arriving from the API — and a formatter
  // is stale if it misses either.
  const unsubscribeSettings = settingsService.subscribe(listener);

  return () => {
    listeners.delete(listener);
    unsubscribeSettings();
  };
}

/**
 * Whether a load has been started this session.
 *
 * Module-level rather than per-component: the first priced screen to mount
 * triggers the fetch and every later one reads the result.
 */
let loading: Promise<void> | null = null;

function loadRates(): void {
  if (loading || rates) return;

  loading = ratesService
    .load()
    .then((loaded) => {
      if (!loaded) return;

      rates = loaded;
      emit();
    })
    .finally(() => {
      loading = null;
    });
}

/**
 * The formatter for the current preference — stable between changes.
 *
 * `useSyncExternalStore` requires a snapshot that keeps its identity, and this
 * one is memoised on the pair it is built from. Returning a fresh formatter
 * per call would be an infinite render loop.
 */
let snapshot: MoneyFormatter = createMoneyFormatter(
  settingsService.getSettings().currency,
  rates ?? undefined,
);

let snapshotKey = `${snapshot.currency}:${rates?.updatedAt ?? ''}`;

function getSnapshot(): MoneyFormatter {
  const currency = settingsService.getSettings().currency;
  const key = `${currency}:${rates?.updatedAt ?? ''}`;

  if (key !== snapshotKey) {
    snapshot = createMoneyFormatter(currency, rates ?? undefined);
    snapshotKey = key;
  }

  return snapshot;
}

/**
 * How to format a price on this screen.
 *
 * Returns a formatter over USD amounts — every price in the app is quoted in
 * dollars, so callers pass the dollar figure they already hold and never
 * convert anything themselves.
 */
export function useMoney(): MoneyFormatter {
  // Kicks off the one fetch per session. In an effect rather than in the
  // render body so a component that never commits — StrictMode's throwaway
  // first pass — does not start network work.
  useEffect(loadRates, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The chosen currency on its own, for the picker that sets it. */
export function useDisplayCurrency(): CurrencyCode {
  return useSyncExternalStore(
    subscribe,
    () => settingsService.getSettings().currency,
    () => settingsService.getSettings().currency,
  );
}

/**
 * Switch currency.
 *
 * Writes through settings, which every subscriber is already listening to, so
 * the change reaches every price in the app — every other open tab, and now
 * every other device.
 *
 * Fire-and-forget on purpose. The cache is written from the server's response,
 * so a failed save simply leaves the previous currency in place; blocking a
 * dropdown on a round trip would make switching feel broken on a slow
 * connection, and prices are a display preference rather than a record.
 */
export function setDisplayCurrency(currency: CurrencyCode): void {
  if (settingsService.getSettings().currency === currency) return;

  void settingsService.save({ currency }).catch(() => undefined);

  // Dram was picked but the day's table never loaded — the reader has asked
  // for something the app cannot yet do, so this is the moment to try again
  // rather than show dollars under a dram label.
  loadRates();
}

/** The rate table currently in use, for the "rates as of" caption. */
export function useExchangeRates(): ExchangeRates | null {
  return useSyncExternalStore(
    subscribe,
    () => rates,
    () => rates,
  );
}

/**
 * Test seam: puts the store back to how it looks on a fresh import.
 *
 * Re-reads the cached table rather than clearing it, because that is what
 * module initialisation does — a reload with rates in storage paints converted
 * prices immediately. A reset that left `rates` null would model a reload that
 * never happens and hide the behaviour worth testing.
 */
export function resetCurrencyStore(): void {
  rates = ratesService.readSync();
  loading = null;
  snapshotKey = '';
}
