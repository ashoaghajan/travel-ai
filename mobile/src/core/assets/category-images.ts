import type { ActivityCategory } from '../types/trip.types';

/* DIFFERS FROM WEB: ids rather than imported images — see itineraryImages.ts. */
const natureImage = 'generic/nature';
const foodImage = 'generic/food';
const cityImage = 'generic/city';
const cliffsImage = 'itinerary/day-3-nusa-penida';

/**
 * Stand-in photography for places the API has no picture for.
 *
 * OpenTripMap only carries a photo when the place has one on Wikimedia, which
 * is a minority of results — without these the grid would be mostly empty
 * gradients.
 */
export const CATEGORY_IMAGES: Record<ActivityCategory, string> = {
  nature: natureImage,
  adventure: cliffsImage,
  culture: cityImage,
  food: foodImage,
  relaxation: natureImage,
  travel: cityImage,
};
