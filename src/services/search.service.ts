import type { FlightSearchQuery } from '../types/travel.types';
import { http } from './http';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Recent searches, so a return visit puts the reader back where they were.
 *
 * On the account now, so a search run on a laptop reopens on a phone. The
 * `localStorage` copy stays for the same reason it does under settings and the
 * chat history: `useFlightSearch` seeds its form state from
 * `getLastFlightSearch()`, so a query arriving after mount would fill the form
 * a moment after the reader started typing in it.
 */

const MAX_RECENT = 5;

type RecentSearches = {
  flights: FlightSearchQuery[];
};

const EMPTY: RecentSearches = { flights: [] };

function readCache(): RecentSearches {
  const stored = storageService.get<Partial<RecentSearches>>(STORAGE_KEYS.recentSearches, EMPTY);

  return { flights: Array.isArray(stored.flights) ? stored.flights : [] };
}

function writeCache(flights: FlightSearchQuery[]): void {
  try {
    storageService.set<RecentSearches>(STORAGE_KEYS.recentSearches, {
      flights: flights.slice(0, MAX_RECENT),
    });
  } catch {
    // Full or blocked storage. The searches are on the server; only the
    // pre-filled form on the next load degrades, and it degrades to defaults.
  }
}

/**
 * The same route on the same dates for the same party is one search.
 *
 * Kept client-side as well as server-side: this is what stops the cache
 * growing a duplicate before the server's answer replaces it.
 */
function isSameFlightSearch(a: FlightSearchQuery, b: FlightSearchQuery): boolean {
  return (
    a.tripType === b.tripType &&
    a.from === b.from &&
    a.to === b.to &&
    a.departDate === b.departDate &&
    a.returnDate === b.returnDate &&
    a.travellers === b.travellers
  );
}

export const searchService = {
  /** The query to reopen the flight search with, or null on a first visit. */
  getLastFlightSearch(): FlightSearchQuery | null {
    return readCache().flights[0] ?? null;
  },

  getRecentFlightSearches(): FlightSearchQuery[] {
    return readCache().flights;
  },

  /**
   * Records a search. Most recent first, de-duplicated, capped at five.
   *
   * Fire-and-forget: this runs on every search, and a reader waiting on it
   * would be waiting for a convenience. The cache is updated immediately so
   * the next visit is right even if the request never lands.
   */
  saveFlightSearch(query: FlightSearchQuery): void {
    const existing = readCache().flights.filter(
      (candidate) => !isSameFlightSearch(candidate, query),
    );

    writeCache([query, ...existing]);

    void http
      .post<FlightSearchQuery[]>('/searches/flights', { query })
      .then((flights) => writeCache(flights))
      .catch(() => undefined);
  },

  /** Adopt the searches that came back from the server. */
  adopt(flights: FlightSearchQuery[]): void {
    if (flights.length === 0) return;

    writeCache(flights);
  },

  /** Re-read from the server, for a search run on another device. */
  async load(): Promise<FlightSearchQuery[]> {
    const flights = await http.get<FlightSearchQuery[]>('/searches/flights');

    searchService.adopt(flights);

    return flights;
  },

  clear(): void {
    storageService.remove(STORAGE_KEYS.recentSearches);

    void http.delete<void>('/searches').catch(() => undefined);
  },

  /** Sign-out: forget this account's searches without deleting them. */
  clearCache(): void {
    storageService.remove(STORAGE_KEYS.recentSearches);
  },
};
