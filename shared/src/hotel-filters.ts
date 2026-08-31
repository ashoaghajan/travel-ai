import type { Hotel } from './travel.types';

/**
 * Sorting and filtering for a list of stays.
 *
 * Shared because three screens now offer it — the web's `/hotels` results, the
 * Hotels tab of the web's booking screen, and the same tab on the phone — and
 * a reader who caps their budget at $200 in one of them and gets a different
 * list in another has been lied to by one of the two. Pure functions over
 * `Hotel[]`, so the rules can be read, reused and tested away from any UI.
 *
 * Everything here is applied client-side over the results already in hand. The
 * provider returns one page of stays for a city and dates; narrowing that page
 * is a view of it, not a new search, so it costs no quota and no spinner.
 */

/**
 * The orders offered, with the two labels the two platforms need.
 *
 * `label` reads as a line in a dropdown, which is what the web renders.
 * `short` is for the phone, where each of these is a chip in a row that has to
 * fit across a handset — "Price: low to high" is a sentence where "Cheapest"
 * is a button. Same ids either way, so a sort is one thing with two spellings
 * rather than two lists that can fall out of step.
 */
export const HOTEL_SORTS = [
  { id: 'recommended', label: 'Recommended', short: 'Recommended' },
  { id: 'price-low', label: 'Price: low to high', short: 'Cheapest' },
  { id: 'price-high', label: 'Price: high to low', short: 'Priciest' },
  { id: 'rating', label: 'Top rated', short: 'Top rated' },
] as const;

export type HotelSortId = (typeof HOTEL_SORTS)[number]['id'];

export type HotelFilters = {
  /**
   * The nightly price span to keep, as two ends that are null until moved.
   *
   * Null rather than the bounds themselves, so "untouched" is a state the
   * filter can be in. A handle resting on the cheapest stay in the list is not
   * a filter — it excludes nothing — and storing it as one would badge the
   * toolbar and count stays as hidden the moment the panel opened.
   */
  minPrice: number | null;
  maxPrice: number | null;
  /** Minimum rating out of 5, or null for any. */
  minRating: number | null;
};

export const EMPTY_HOTEL_FILTERS: HotelFilters = {
  minPrice: null,
  maxPrice: null,
  minRating: null,
};

/**
 * The rating floors offered.
 *
 * Fixed rather than derived, because unlike a price a rating is an absolute
 * scale: 4.5 means the same thing in Hanoi as in Zurich. The ladder is the
 * 5-point equivalent of the 7/8/9 that the booking sites offer out of 10.
 */
export const MIN_RATING_OPTIONS = [3.5, 4, 4.5] as const;

/**
 * How many filters are narrowing the list — for the toolbar's badge.
 *
 * The price span counts once however many of its ends have moved: it is one
 * control on screen, and a reader who dragged both handles of one slider has
 * not applied two filters.
 */
export function countActiveFilters(filters: HotelFilters): number {
  const price = filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0;
  const rating = filters.minRating !== null ? 1 : 0;

  return price + rating;
}

/**
 * The step a price handle moves in.
 *
 * Derived from the span rather than fixed, so a slider has roughly the same
 * number of stops whatever it is spanning: $10 is a meaningful move on a
 * $90–$300 list and imperceptible on a $400–$4,000 one. Rounded to a figure a
 * reader would recognise as a price increment rather than to `span / 20`.
 */
function stepFor(span: number): number {
  const rough = span / 20;

  for (const step of [1, 5, 10, 25, 50, 100, 250]) {
    if (rough <= step) return step;
  }

  return 500;
}

export type PriceBounds = {
  /** The cheapest stay in the list, rounded down to a whole step. */
  min: number;
  /** The dearest, rounded up to a whole step. */
  max: number;
  /** What one nudge of a handle is worth. */
  step: number;
};

/**
 * The price span the results actually cover, for a range control to run across.
 *
 * Drawn from the results rather than fixed, which is the whole point: a slider
 * running $0–$500 is most of its length dead in Hanoi and stops short of every
 * stay in Zurich. Running it from the cheapest room on the page to the dearest
 * means every position on it divides *this* list.
 *
 * The ends are rounded outwards to whole steps so the extremes are round
 * numbers, and so a handle parked at either end cannot accidentally exclude the
 * stay it was drawn from.
 *
 * Null when there is nothing to range over: fewer than two priced stays, or a
 * list that is all one price. The caller then offers no price filter at all,
 * which is honest — a control that cannot change the list is worse than a
 * missing one. That is also the ordinary state for an unpriced `listing`
 * result, where no stay carries a rate.
 */
export function priceBounds(hotels: Hotel[]): PriceBounds | null {
  const prices = hotels
    .map((hotel) => hotel.pricePerNight)
    .filter((price): price is number => price !== null);

  if (prices.length < 2) return null;

  const cheapest = Math.min(...prices);
  const dearest = Math.max(...prices);
  if (dearest <= cheapest) return null;

  const step = stepFor(dearest - cheapest);

  return {
    min: Math.floor(cheapest / step) * step,
    max: Math.ceil(dearest / step) * step,
    step,
  };
}

/**
 * A moved handle, or null for one still resting on the end of the range.
 *
 * The rule that keeps `countActiveFilters` and "showing n of m" honest: only a
 * handle that has come off the extreme is filtering anything, so that is the
 * only one recorded.
 */
export function priceHandle(value: number, bound: number): number | null {
  return value === bound ? null : value;
}

/**
 * The rating floors worth offering for this list.
 *
 * Empty when nothing in it is rated, which is the whole list whenever the
 * results came from the places directory rather than a rate provider — see
 * `PriceSource`. Offering "4.5+" there would empty the screen and read as a
 * fault, because an unrated stay shows no rating at all to explain itself.
 */
export function ratingFilterOptions(hotels: Hotel[]): number[] {
  const best = hotels.reduce((highest, hotel) => Math.max(highest, hotel.rating), 0);

  return MIN_RATING_OPTIONS.filter((floor) => floor <= best);
}

/**
 * An unpriced stay survives a price filter.
 *
 * `pricePerNight` is null whenever no provider has quoted one. Treating
 * "unknown" as "outside the range" would empty the screen the moment someone
 * touched the slider, and it is not what a reader setting a budget means —
 * they mean "hide the ones I know are outside it".
 *
 * An unrated stay does *not* survive a rating filter, and the asymmetry is
 * deliberate. A missing price says so on the card — "Price on partner site" —
 * so a reader can see why that row is still there. A missing rating shows
 * nothing at all, so keeping it under a "4.5+" floor would look like the
 * filter had failed. `ratingFilterOptions` is what stops this from emptying an
 * unrated list: it offers no floor there in the first place.
 */
export function applyHotelFilters(hotels: Hotel[], filters: HotelFilters): Hotel[] {
  return hotels.filter((hotel) => {
    const { pricePerNight } = hotel;

    if (pricePerNight !== null) {
      if (filters.minPrice !== null && pricePerNight < filters.minPrice) return false;
      if (filters.maxPrice !== null && pricePerNight > filters.maxPrice) return false;
    }
    if (filters.minRating !== null && hotel.rating < filters.minRating) return false;

    return true;
  });
}

export function sortHotels(hotels: Hotel[], sort: HotelSortId): Hotel[] {
  // "Recommended" is the order the service returns.
  if (sort === 'recommended') return hotels;

  return [...hotels].sort((a, b) => {
    if (sort === 'rating') return b.rating - a.rating;

    /*
     * Unpriced stays sort last in *both* price directions rather than as free
     * ones — `null` coerces to 0 in arithmetic, which would put every unknown
     * at the top of "cheapest". They are not the dearest either, so they are
     * not simply the reverse: an unknown belongs at the end of the list the
     * reader is reading, whichever way that list runs.
     */
    if (a.pricePerNight === null) return b.pricePerNight === null ? 0 : 1;
    if (b.pricePerNight === null) return -1;

    return sort === 'price-low'
      ? a.pricePerNight - b.pricePerNight
      : b.pricePerNight - a.pricePerNight;
  });
}
