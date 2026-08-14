import type { ActivityCategory } from '../types/trip.types';

/**
 * Photographs for a generated itinerary.
 *
 * **A copy of `src/utils/itineraryImages.ts`. DIFFERS FROM WEB in what it
 * returns: an id, not a URL.**
 *
 * The web imports four `.jpg` files and returns whichever Vite resolved to a
 * URL string. Metro resolves an image import to an opaque module number
 * instead, so the same code here would put a number into `TripDraft.coverImage`
 * and `ItineraryDay.image` — and those are stored and PUT to the API. That is
 * not a broken picture; it is corrupt data, and the web would then try to
 * render it.
 *
 * So the *choosing* is copied exactly and the *value* is a stable id. Drawing
 * happens through `imageSource` in `mobile/src/assets/bundled-images.ts`, and
 * the web reads these ids through `resolveBundledSrc`.
 *
 * Everything below this line — which category wins, and why — is the web's
 * logic unchanged.
 */

const COAST = 'generic/coast';
const CITY = 'generic/city';
const NATURE = 'generic/nature';
const FOOD = 'generic/food';

const CATEGORY_IMAGES: Record<ActivityCategory, string> = {
  food: FOOD,
  nature: NATURE,
  culture: CITY,
  adventure: NATURE,
  relaxation: COAST,
  travel: CITY,
};

/**
 * The photo for a day, from what is actually planned in it.
 *
 * The most-repeated category wins, so a day with two museums and a lunch reads
 * as a culture day rather than a food one. Ties go to whichever appeared first,
 * which is the morning — the part of the day that sets its tone.
 */
export function dayImage(categories: ActivityCategory[]): string {
  const counts = new Map<ActivityCategory, number>();

  for (const category of categories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let best: ActivityCategory | null = null;
  let bestCount = 0;

  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }

  return best ? CATEGORY_IMAGES[best] : CITY;
}

/**
 * The cover, chosen from the whole trip rather than one day.
 *
 * A trip is remembered by its landscape, so the outdoor images outrank the
 * street scene: somewhere with a beach day leads with the coast even if most of
 * the week is spent in museums.
 */
export function coverImage(categories: ActivityCategory[]): string {
  if (categories.includes('relaxation')) return COAST;
  if (categories.includes('nature') || categories.includes('adventure')) return NATURE;

  return CITY;
}
