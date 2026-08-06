import cityImage from './generic/city.jpg';
import coastImage from './generic/coast.jpg';
import natureImage from './generic/nature.jpg';
import ubudImage from './itinerary/day-1-ubud.jpg';
import terracesImage from './itinerary/day-2-ubud.jpg';
import cliffsImage from './itinerary/day-3-nusa-penida.jpg';
import uluwatuImage from './itinerary/day-4-uluwatu.jpg';

/**
 * Stand-in photography for stays, mirroring `category-images.ts`.
 *
 * The listings directory carries no photographs at all — not "a minority", as
 * with attractions, but none: twelve of twelve Dubai hotels came back without
 * one. Without these the list is a column of empty gradients.
 *
 * Generic scenery on purpose. There are photographs of four real named hotels
 * in `assets/hotels/`, and using one of those here would say *this is what
 * that property looks like*, which we do not know. A landscape says only
 * "somewhere to stay", which is honest. `category-images.ts` already reuses
 * these same itinerary photographs as stand-ins for the explorer.
 */
const SCENERY = [
  cityImage,
  natureImage,
  coastImage,
  ubudImage,
  terracesImage,
  cliffsImage,
  uluwatuImage,
] as const;

/**
 * A stable index for an id.
 *
 * Mapping by *category* was the obvious first try and looked broken: every
 * stay in Ubud is a guest house, so twelve cards showed one photograph. The id
 * varies where the category does not, and hashing it keeps a given stay on the
 * same picture between renders and between visits.
 */
function hash(id: string): number {
  let value = 0;
  for (let index = 0; index < id.length; index += 1) {
    value = (value * 31 + id.charCodeAt(index)) | 0;
  }

  return Math.abs(value);
}

/** The stand-in for one stay. Same stay, same picture, every time. */
export function lodgingImage(id: string): string {
  return SCENERY[hash(id) % SCENERY.length];
}
