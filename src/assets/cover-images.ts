import cityImage from './generic/city.jpg';
import coastImage from './generic/coast.jpg';
import natureImage from './generic/nature.jpg';
import foodImage from './generic/food.jpg';

/**
 * Covers a hand-made trip can choose from.
 *
 * The bundled generics, deliberately: Stage 1 has no image search, and a trip
 * with no photograph looks unfinished next to a generated one. Attribution for
 * every file is in `CREDITS.md`.
 *
 * The first entry is the default a new trip opens with.
 */

export type CoverImage = {
  id: string;
  /** Shown under the thumbnail in the picker. */
  label: string;
  src: string;
};

export const COVER_IMAGES: readonly CoverImage[] = [
  { id: 'city', label: 'City', src: cityImage },
  { id: 'coast', label: 'Coast', src: coastImage },
  { id: 'nature', label: 'Nature', src: natureImage },
  { id: 'food', label: 'Food', src: foodImage },
];
