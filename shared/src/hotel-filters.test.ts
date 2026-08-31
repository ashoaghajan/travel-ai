import { describe, expect, it } from 'vitest';
import type { Hotel } from './travel.types';
import {
  EMPTY_HOTEL_FILTERS,
  HOTEL_SORTS,
  applyHotelFilters,
  countActiveFilters,
  priceBounds,
  priceHandle,
  ratingFilterOptions,
  sortHotels,
} from './hotel-filters';

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

/** Four priced, rated stays — the shape of a `live` result. */
const STAYS: Hotel[] = [
  hotel({ id: 'a', name: 'Komaneka', rating: 4.8, pricePerNight: 320 }),
  hotel({ id: 'b', name: 'Alaya', rating: 4.6, pricePerNight: 195 }),
  hotel({ id: 'c', name: 'Ubud Village', rating: 4.5, pricePerNight: 160 }),
  hotel({ id: 'd', name: 'Element', rating: 4.4, pricePerNight: 138 }),
];

/** What the places directory returns: real stays, no price and no score. */
const LISTINGS: Hotel[] = [
  hotel({ id: 'e', name: 'Guest house Umbrella', rating: 0, reviews: 0, pricePerNight: null }),
  hotel({ id: 'f', name: 'Hotel Villa Tiflisi', rating: 0, reviews: 0, pricePerNight: null }),
];

const names = (hotels: Hotel[]) => hotels.map((h) => h.name);

describe('applyHotelFilters', () => {
  it('returns everything when no filter is set', () => {
    expect(applyHotelFilters(STAYS, EMPTY_HOTEL_FILTERS)).toHaveLength(STAYS.length);
  });

  it('keeps stays at or under the price cap', () => {
    const filtered = applyHotelFilters(STAYS, { minPrice: null, maxPrice: 200, minRating: null });

    expect(filtered.every((h) => h.pricePerNight !== null && h.pricePerNight <= 200)).toBe(true);
    expect(names(filtered)).toEqual(['Alaya', 'Ubud Village', 'Element']);
  });

  it('includes a stay priced exactly at the cap', () => {
    const filtered = applyHotelFilters([hotel({ pricePerNight: 200 })], {
      minPrice: null,
      maxPrice: 200,
      minRating: null,
    });

    expect(filtered).toHaveLength(1);
  });

  it('drops the stays under a price floor', () => {
    const filtered = applyHotelFilters(STAYS, { minPrice: 190, maxPrice: null, minRating: null });

    expect(names(filtered)).toEqual(['Komaneka', 'Alaya']);
  });

  it('keeps only what falls inside both ends of the range', () => {
    const filtered = applyHotelFilters(STAYS, { minPrice: 150, maxPrice: 200, minRating: null });

    expect(names(filtered)).toEqual(['Alaya', 'Ubud Village']);
  });

  it('keeps an unpriced stay inside any range', () => {
    const filtered = applyHotelFilters(LISTINGS, { minPrice: null, maxPrice: 100, minRating: null });

    expect(filtered).toHaveLength(2);
  });

  it('keeps stays at or above the rating floor', () => {
    const filtered = applyHotelFilters(STAYS, { minPrice: null, maxPrice: null, minRating: 4.5 });

    expect(filtered.every((h) => h.rating >= 4.5)).toBe(true);
    expect(filtered).toHaveLength(3);
  });

  it('drops an unrated stay under a rating floor', () => {
    expect(applyHotelFilters(LISTINGS, { minPrice: null, maxPrice: null, minRating: 3.5 })).toEqual([]);
  });

  it('applies both filters together', () => {
    const filtered = applyHotelFilters(STAYS, { minPrice: null, maxPrice: 200, minRating: 4.5 });

    expect(names(filtered)).toEqual(['Alaya', 'Ubud Village']);
  });

  it('can filter everything out', () => {
    expect(applyHotelFilters(STAYS, { minPrice: null, maxPrice: 50, minRating: 4.9 })).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(applyHotelFilters([], { minPrice: null, maxPrice: 100, minRating: 4 })).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [...STAYS];
    applyHotelFilters(input, { minPrice: null, maxPrice: 150, minRating: null });

    expect(input).toEqual(STAYS);
  });
});

describe('sortHotels', () => {
  it('leaves the service order alone for "recommended"', () => {
    expect(names(sortHotels(STAYS, 'recommended'))).toEqual(names(STAYS));
  });

  it('sorts by price ascending', () => {
    expect(sortHotels(STAYS, 'price-low').map((h) => h.pricePerNight)).toEqual([138, 160, 195, 320]);
  });

  it('sorts by price descending', () => {
    expect(sortHotels(STAYS, 'price-high').map((h) => h.pricePerNight)).toEqual([
      320, 195, 160, 138,
    ]);
  });

  it('sorts by rating descending', () => {
    expect(sortHotels(STAYS, 'rating').map((h) => h.rating)).toEqual([4.8, 4.6, 4.5, 4.4]);
  });

  it('puts unpriced stays last whichever way price runs', () => {
    const mixed = [hotel({ name: 'Unknown', pricePerNight: null }), ...STAYS];

    expect(names(sortHotels(mixed, 'price-low')).at(-1)).toBe('Unknown');
    expect(names(sortHotels(mixed, 'price-high')).at(-1)).toBe('Unknown');
  });

  it('does not mutate the input', () => {
    const input = [...STAYS];
    sortHotels(input, 'price-low');

    expect(names(input)).toEqual(names(STAYS));
  });

  it('handles empty and single-item lists', () => {
    expect(sortHotels([], 'price-low')).toEqual([]);
    expect(sortHotels([hotel()], 'rating')).toHaveLength(1);
  });
});

describe('priceBounds', () => {
  it('spans the cheapest stay to the dearest', () => {
    // 138–320, rounded outwards to whole steps of 10.
    expect(priceBounds(STAYS)).toEqual({ min: 130, max: 320, step: 10 });
  });

  it('leaves every stay inside the untouched range', () => {
    const bounds = priceBounds(STAYS);

    const kept = applyHotelFilters(STAYS, {
      minPrice: bounds!.min,
      maxPrice: bounds!.max,
      minRating: null,
    });

    // Handles parked at the ends must not exclude the stays they were drawn
    // from — the reason the bounds round outwards rather than to the figures.
    expect(kept).toHaveLength(STAYS.length);
  });

  it('scales to an expensive city rather than sitting under it', () => {
    const zurich = [
      hotel({ id: 'z1', pricePerNight: 420 }),
      hotel({ id: 'z2', pricePerNight: 610 }),
      hotel({ id: 'z3', pricePerNight: 980 }),
    ];

    const bounds = priceBounds(zurich)!;

    expect(bounds.min).toBeLessThanOrEqual(420);
    expect(bounds.max).toBeGreaterThanOrEqual(980);
    // Roughly twenty stops, whatever the span.
    expect((bounds.max - bounds.min) / bounds.step).toBeGreaterThan(5);
    expect((bounds.max - bounds.min) / bounds.step).toBeLessThan(60);
  });

  it('offers nothing when there is nothing to range over', () => {
    expect(priceBounds(LISTINGS)).toBeNull();
    expect(priceBounds([hotel({ pricePerNight: 200 })])).toBeNull();
    expect(
      priceBounds([hotel({ id: 'x', pricePerNight: 200 }), hotel({ id: 'y', pricePerNight: 200 })]),
    ).toBeNull();
    expect(priceBounds([])).toBeNull();
  });
});

describe('priceHandle', () => {
  it('reads a handle resting on the end of the range as no filter at all', () => {
    expect(priceHandle(130, 130)).toBeNull();
  });

  it('records a handle that has been moved off it', () => {
    expect(priceHandle(180, 130)).toBe(180);
  });
});

describe('ratingFilterOptions', () => {
  it('offers the floors a rated list can meet', () => {
    expect(ratingFilterOptions(STAYS)).toEqual([3.5, 4, 4.5]);
  });

  it('drops floors nothing in the list reaches', () => {
    expect(ratingFilterOptions([hotel({ rating: 3.9 })])).toEqual([3.5]);
  });

  it('offers nothing for an unrated list', () => {
    expect(ratingFilterOptions(LISTINGS)).toEqual([]);
    expect(ratingFilterOptions([])).toEqual([]);
  });
});

describe('countActiveFilters', () => {
  it('counts nothing when the filters are empty', () => {
    expect(countActiveFilters(EMPTY_HOTEL_FILTERS)).toBe(0);
  });

  it('counts each set filter', () => {
    expect(countActiveFilters({ minPrice: null, maxPrice: 200, minRating: null })).toBe(1);
    expect(countActiveFilters({ minPrice: null, maxPrice: 200, minRating: 4.5 })).toBe(2);
  });

  /* One slider, however many of its handles have moved. */
  it('counts a price range once, not once per handle', () => {
    expect(countActiveFilters({ minPrice: 150, maxPrice: 250, minRating: null })).toBe(1);
    expect(countActiveFilters({ minPrice: 150, maxPrice: null, minRating: null })).toBe(1);
  });
});

describe('sort options', () => {
  it('offers the four documented sorts', () => {
    expect(HOTEL_SORTS.map((option) => option.id)).toEqual([
      'recommended',
      'price-low',
      'price-high',
      'rating',
    ]);
  });
});
