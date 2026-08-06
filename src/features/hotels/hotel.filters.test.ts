import { describe, expect, it } from 'vitest';
import type { Hotel } from '../../types/travel.types';
import { MOCK_HOTELS } from '../../mock/hotels';
import {
  EMPTY_HOTEL_FILTERS,
  HOTEL_SORTS,
  applyHotelFilters,
  countActiveFilters,
  sortHotels,
} from './hotel.filters';

function hotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-1',
    name: 'Test Stay',
    location: 'Ubud',
    category: 'Resort',
    rating: 4.5,
    reviews: 100,
    pricePerNight: 200,
    image: '/stay.jpg',
    bookingUrl: null,
    ...overrides,
  };
}

const names = (hotels: Hotel[]) => hotels.map((h) => h.name);

describe('applyHotelFilters', () => {
  it('returns everything when no filter is set', () => {
    expect(applyHotelFilters(MOCK_HOTELS, EMPTY_HOTEL_FILTERS)).toHaveLength(MOCK_HOTELS.length);
  });

  it('keeps stays at or under the price cap', () => {
    const filtered = applyHotelFilters(MOCK_HOTELS, { maxPrice: 200, minRating: null });

    expect(filtered.every((h) => h.pricePerNight !== null && h.pricePerNight <= 200)).toBe(true);
    expect(names(filtered)).toEqual([
      'Alaya Resort Ubud',
      'The Ubud Village Resort',
      'Element by Westin Bali Ubud',
    ]);
  });

  it('includes a stay priced exactly at the cap', () => {
    const filtered = applyHotelFilters([hotel({ pricePerNight: 200 })], {
      maxPrice: 200,
      minRating: null,
    });

    expect(filtered).toHaveLength(1);
  });

  it('keeps stays at or above the rating floor', () => {
    const filtered = applyHotelFilters(MOCK_HOTELS, { maxPrice: null, minRating: 4.5 });

    expect(filtered.every((h) => h.rating >= 4.5)).toBe(true);
    expect(filtered).toHaveLength(3);
  });

  it('applies both filters together', () => {
    const filtered = applyHotelFilters(MOCK_HOTELS, { maxPrice: 200, minRating: 4.5 });

    expect(names(filtered)).toEqual(['Alaya Resort Ubud', 'The Ubud Village Resort']);
  });

  it('can filter everything out', () => {
    expect(applyHotelFilters(MOCK_HOTELS, { maxPrice: 50, minRating: 4.9 })).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(applyHotelFilters([], { maxPrice: 100, minRating: 4 })).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [...MOCK_HOTELS];
    applyHotelFilters(input, { maxPrice: 150, minRating: null });

    expect(input).toEqual(MOCK_HOTELS);
  });
});

describe('sortHotels', () => {
  it('leaves the service order alone for "recommended"', () => {
    expect(names(sortHotels(MOCK_HOTELS, 'recommended'))).toEqual(names(MOCK_HOTELS));
  });

  it('sorts by price ascending', () => {
    const sorted = sortHotels(MOCK_HOTELS, 'price-low');
    expect(sorted.map((h) => h.pricePerNight)).toEqual([138, 160, 195, 320]);
  });

  it('sorts by rating descending', () => {
    const sorted = sortHotels(MOCK_HOTELS, 'rating');
    expect(sorted.map((h) => h.rating)).toEqual([4.8, 4.6, 4.5, 4.4]);
  });

  it('does not mutate the input', () => {
    const input = [...MOCK_HOTELS];
    sortHotels(input, 'price-low');

    expect(names(input)).toEqual(names(MOCK_HOTELS));
  });

  it('handles empty and single-item lists', () => {
    expect(sortHotels([], 'price-low')).toEqual([]);
    expect(sortHotels([hotel()], 'rating')).toHaveLength(1);
  });
});

describe('countActiveFilters', () => {
  it('counts nothing when the filters are empty', () => {
    expect(countActiveFilters(EMPTY_HOTEL_FILTERS)).toBe(0);
  });

  it('counts each set filter', () => {
    expect(countActiveFilters({ maxPrice: 200, minRating: null })).toBe(1);
    expect(countActiveFilters({ maxPrice: 200, minRating: 4.5 })).toBe(2);
  });
});

describe('sort options', () => {
  it('offers the three documented sorts', () => {
    expect(HOTEL_SORTS.map((option) => option.id)).toEqual([
      'recommended',
      'price-low',
      'rating',
    ]);
  });
});
