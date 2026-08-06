import type { ActivityCategory } from '../types/trip.types';
import coastImage from '../assets/generic/coast.jpg';
import cityImage from '../assets/generic/city.jpg';
import natureImage from '../assets/generic/nature.jpg';
import foodImage from '../assets/generic/food.jpg';

/**
 * Photographs for a generated itinerary.
 *
 * The model writes the days; it cannot supply the pictures. It has no image
 * output, and a URL it recalled would as likely be dead as right — a broken
 * thumbnail on every card is worse than an honest stock photo.
 *
 * So the day's own activities choose one of four bundled images. It is not the
 * place in the photo, and it does not pretend to be: a beach day gets the
 * coast, a museum day gets the city. What it gets right is the *feel* of the
 * day, which is all a card-sized image conveys anyway.
 *
 * These are Vite-bundled assets — resolved at build time into hashed URLs — so
 * this cannot live on the server, which is why the API returns a plan and the
 * client assembles the `TripDraft`.
 */

const CATEGORY_IMAGES: Record<ActivityCategory, string> = {
  food: foodImage,
  nature: natureImage,
  culture: cityImage,
  adventure: natureImage,
  relaxation: coastImage,
  travel: cityImage,
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

  return best ? CATEGORY_IMAGES[best] : cityImage;
}

/**
 * The cover, chosen from the whole trip rather than one day.
 *
 * A trip is remembered by its landscape, so the outdoor images outrank the
 * street scene: somewhere with a beach day leads with the coast even if most of
 * the week is spent in museums.
 */
export function coverImage(categories: ActivityCategory[]): string {
  if (categories.includes('relaxation')) return coastImage;
  if (categories.includes('nature') || categories.includes('adventure')) return natureImage;

  return cityImage;
}
