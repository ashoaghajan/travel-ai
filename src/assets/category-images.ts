import type { ActivityCategory } from '../types/trip.types';
import natureImage from './generic/nature.jpg';
import foodImage from './generic/food.jpg';
import cityImage from './generic/city.jpg';
import cliffsImage from './itinerary/day-3-nusa-penida.jpg';

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
