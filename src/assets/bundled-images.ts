import cityImage from './generic/city.jpg';
import coastImage from './generic/coast.jpg';
import foodImage from './generic/food.jpg';
import natureImage from './generic/nature.jpg';
import dayOneUbud from './itinerary/day-1-ubud.jpg';
import dayTwoUbud from './itinerary/day-2-ubud.jpg';
import dayThreeNusaPenida from './itinerary/day-3-nusa-penida.jpg';
import dayFourUluwatu from './itinerary/day-4-uluwatu.jpg';

/**
 * The photographs that ship with the app, under names that outlive a build.
 *
 * Every one of these is a Vite asset import, so what a trip actually stores is
 * whatever URL this build resolved it to — `/src/assets/generic/coast.jpg` in
 * development, `/assets/coast-9f2a1b.jpg` in production, and a different hash
 * again after the next deploy. That is fine while a trip stays in the app that
 * made it, and wrong the moment one travels: a trip exported from a laptop and
 * imported into a deployed copy would point every picture at a path that
 * environment has never served.
 *
 * So a file carries the *id* alongside the URL, and an importer resolves the id
 * against its own build. The URL stays in the file as a fallback for anything
 * not from this list — an OpenTripMap photo, say — which needs no translation.
 *
 * Overlaps `cover-images.ts` by four files and is deliberately separate: that
 * one is a picker, with labels and an order a reader sees, and it covers only
 * the covers. This is the transport table, and it has to name every bundled
 * picture a trip can end up holding — including the itinerary photographs,
 * which no picker offers.
 */
export const BUNDLED_IMAGES: Readonly<Record<string, string>> = {
  'generic/city': cityImage,
  'generic/coast': coastImage,
  'generic/food': foodImage,
  'generic/nature': natureImage,
  'itinerary/day-1-ubud': dayOneUbud,
  'itinerary/day-2-ubud': dayTwoUbud,
  'itinerary/day-3-nusa-penida': dayThreeNusaPenida,
  'itinerary/day-4-uluwatu': dayFourUluwatu,
};

/** The stable name for a URL this build produced, if it is one of ours. */
export function bundledImageId(src: unknown): string | undefined {
  if (typeof src !== 'string' || !src) return undefined;

  return Object.keys(BUNDLED_IMAGES).find((id) => BUNDLED_IMAGES[id] === src);
}

/** This build's URL for a stable name, if it still ships that picture. */
export function bundledImageSrc(id: unknown): string | undefined {
  return typeof id === 'string' ? BUNDLED_IMAGES[id] : undefined;
}
