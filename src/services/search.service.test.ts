/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { FlightSearchQuery } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { searchService } from './search.service';

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
