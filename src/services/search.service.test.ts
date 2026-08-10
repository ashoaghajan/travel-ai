/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlightSearchQuery } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { searchService } from './search.service';
import { http } from './http';

function query(overrides: Partial<FlightSearchQuery> = {}): FlightSearchQuery {
  return {
    tripType: 'round-trip',
    from: 'JFK',
    to: 'DPS',
    departDate: '2027-05-20',
    returnDate: '2027-05-28',
    travellers: 2,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLastFlightSearch', () => {
  it('is null on a first visit', () => {
    expect(searchService.getLastFlightSearch()).toBeNull();
  });

  it('returns the most recent search', () => {
    searchService.saveFlightSearch(query());
    searchService.saveFlightSearch(query({ from: 'LHR', to: 'HND' }));

    expect(searchService.getLastFlightSearch()).toMatchObject({ from: 'LHR', to: 'HND' });
  });

  it('survives a corrupt record', () => {
    localStorage.setItem(STORAGE_KEYS.recentSearches, 'not json');
    expect(searchService.getLastFlightSearch()).toBeNull();
  });

  it('survives a record with the wrong shape', () => {
    storageService.set(STORAGE_KEYS.recentSearches, { flights: 'nope' });
    expect(searchService.getRecentFlightSearches()).toEqual([]);
  });
});

describe('saveFlightSearch', () => {
  it('keeps the most recent search first', () => {
    searchService.saveFlightSearch(query({ from: 'JFK' }));
    searchService.saveFlightSearch(query({ from: 'LHR' }));
    searchService.saveFlightSearch(query({ from: 'CDG' }));

    expect(searchService.getRecentFlightSearches().map((search) => search.from)).toEqual([
      'CDG',
      'LHR',
      'JFK',
    ]);
  });

  it('does not store the same search twice', () => {
    searchService.saveFlightSearch(query());
    searchService.saveFlightSearch(query());

    expect(searchService.getRecentFlightSearches()).toHaveLength(1);
  });

  it('moves a repeated search back to the front', () => {
    searchService.saveFlightSearch(query({ from: 'JFK' }));
    searchService.saveFlightSearch(query({ from: 'LHR' }));
    searchService.saveFlightSearch(query({ from: 'JFK' }));

    expect(searchService.getRecentFlightSearches().map((search) => search.from)).toEqual([
      'JFK',
      'LHR',
    ]);
  });

  it('treats a changed date as a different search', () => {
    searchService.saveFlightSearch(query());
    searchService.saveFlightSearch(query({ departDate: '2027-06-01' }));

    expect(searchService.getRecentFlightSearches()).toHaveLength(2);
  });

  it('keeps at most five searches', () => {
    for (const from of ['JFK', 'LHR', 'CDG', 'DXB', 'DOH', 'SIN', 'HND']) {
      searchService.saveFlightSearch(query({ from }));
    }

    const recent = searchService.getRecentFlightSearches();
    expect(recent).toHaveLength(5);
    expect(recent[0].from).toBe('HND');
    expect(recent.map((search) => search.from)).not.toContain('JFK');
  });
});

describe('clear', () => {
  it('forgets every search', () => {
    searchService.saveFlightSearch(query());
    searchService.clear();

    expect(searchService.getRecentFlightSearches()).toEqual([]);
  });
});

describe('the account\'s copy', () => {
  it('sends the search to the server', () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue([]);

    searchService.saveFlightSearch(query());

    expect(post).toHaveBeenCalledWith('/searches/flights', { query: query() });
  });

  it('replaces the cache with the list the server answered with', async () => {
    const fromServer = [query({ from: 'AUH' })];
    vi.spyOn(http, 'post').mockResolvedValue(fromServer);

    searchService.saveFlightSearch(query());
    await vi.waitFor(() => expect(searchService.getRecentFlightSearches()).toEqual(fromServer));
  });

  it('keeps the local copy when the save never lands', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(new Error('offline'));

    searchService.saveFlightSearch(query());

    // Written to the cache first, so the next visit is right even when the
    // request fails — this is a convenience, not a record.
    expect(searchService.getLastFlightSearch()).toEqual(query());
  });

  it('adopts what the server holds', async () => {
    const fromServer = [query({ to: 'LHR' })];
    vi.spyOn(http, 'get').mockResolvedValue(fromServer);

    await searchService.load();

    expect(searchService.getRecentFlightSearches()).toEqual(fromServer);
  });

  it('does not overwrite the cache with an empty list', () => {
    searchService.adopt([query()]);

    // A new device reading an account that has never searched would otherwise
    // wipe what this browser is holding.
    searchService.adopt([]);

    expect(searchService.getLastFlightSearch()).toEqual(query());
  });

  it('tells the server when the searches are cleared', () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    searchService.clear();

    expect(remove).toHaveBeenCalledWith('/searches');
  });

  it('forgets the cache on sign-out without deleting the searches', () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);
    searchService.adopt([query()]);

    searchService.clearCache();

    expect(searchService.getLastFlightSearch()).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});
