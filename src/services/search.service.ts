import type { FlightSearchQuery } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Recent searches, so a reload puts the user back where they were.
 *
 * Stage 2 can move this to the account without changing the call sites.
 */

const MAX_RECENT = 5;

type RecentSearches = {
  flights: FlightSearchQuery[];
};

const EMPTY: RecentSearches = { flights: [] };

function read(): RecentSearches {
  const stored = storageService.get<Partial<RecentSearches>>(STORAGE_KEYS.recentSearches, EMPTY);
  return { flights: Array.isArray(stored.flights) ? stored.flights : [] };
}

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
    return read().flights[0] ?? null;
  },

  getRecentFlightSearches(): FlightSearchQuery[] {
    return read().flights;
  },

  /** Most recent first, de-duplicated, capped at five. */
  saveFlightSearch(query: FlightSearchQuery): void {
    const existing = read().flights.filter((candidate) => !isSameFlightSearch(candidate, query));
    storageService.set<RecentSearches>(STORAGE_KEYS.recentSearches, {
      flights: [query, ...existing].slice(0, MAX_RECENT),
    });
  },

  clear(): void {
    storageService.remove(STORAGE_KEYS.recentSearches);
  },
};
