import type { Hotel } from '../../types/travel.types';

/**
 * Pure filtering and sorting for the hotel list. Kept out of the components so
 * the rules can be read, reused and tested on their own.
 */

export const HOTEL_SORTS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'price-low', label: 'Price: low to high' },
  { id: 'rating', label: 'Top rated' },
] as const;

export type HotelSortId = (typeof HOTEL_SORTS)[number]['id'];

export type HotelFilters = {
  /** Maximum nightly price, or null for any. */
  maxPrice: number | null;
  /** Minimum rating out of 5, or null for any. */
  minRating: number | null;
};

export const EMPTY_HOTEL_FILTERS: HotelFilters = {
  maxPrice: null,
  minRating: null,
};

export const MAX_PRICE_OPTIONS = [150, 200, 300] as const;
export const MIN_RATING_OPTIONS = [4, 4.5, 4.7] as const;

export function countActiveFilters(filters: HotelFilters): number {
  return Object.values(filters).filter((value) => value !== null).length;
}

/**
 * An unpriced stay survives a price filter.
 *
 * `pricePerNight` is null whenever no provider has quoted one, which is every
 * real listing today. Treating "unknown" as "too expensive" would empty the
 * screen the moment someone touched the filter, and it is not what a reader
 * capping their budget means — they mean "hide the ones I know are over it".
 */
export function applyHotelFilters(hotels: Hotel[], filters: HotelFilters): Hotel[] {
  return hotels.filter((hotel) => {
    const { pricePerNight } = hotel;

    if (filters.maxPrice !== null && pricePerNight !== null && pricePerNight > filters.maxPrice) {
      return false;
    }
    if (filters.minRating !== null && hotel.rating < filters.minRating) return false;

    return true;
  });
}

export function sortHotels(hotels: Hotel[], sort: HotelSortId): Hotel[] {
  // "Recommended" is the order the service returns.
  if (sort === 'recommended') return hotels;

  return [...hotels].sort((a, b) => {
    if (sort !== 'price-low') return b.rating - a.rating;

    // Unpriced stays sort last rather than as free ones — `null` coerces to 0
    // in arithmetic, which would put every unknown at the top of "cheapest".
    if (a.pricePerNight === null) return b.pricePerNight === null ? 0 : 1;
    if (b.pricePerNight === null) return -1;

    return a.pricePerNight - b.pricePerNight;
  });
}
