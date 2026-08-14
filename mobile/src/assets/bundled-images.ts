import type { ImageSourcePropType } from 'react-native';

/**
 * The photographs that ship with the app, by the same ids the web uses.
 *
 * **The reason this file exists at all is that Metro and Vite disagree about
 * what an image import *is*.** Vite resolves `import x from './coast.jpg'` to a
 * URL string; Metro resolves it to an opaque module number. The web can
 * therefore store what it imported, and a phone cannot — a number written into
 * a `TripDraft` and PUT to the API is not a broken picture, it is corrupt data
 * that the web would then try to render.
 *
 * So on this side the id is the value that travels. `coverImage()` and
 * `dayImage()` return `'generic/coast'`, that is what is stored and sent, and
 * this table is consulted only at the moment something is drawn.
 *
 * The web reads those ids: `resolveBundledSrc` in `src/assets/bundled-images.ts`
 * checks for one before its file-name matching, so a trip planned on a phone
 * shows the right photographs in a browser.
 */
const BUNDLED: Record<string, ImageSourcePropType> = {
  'generic/city': require('./city.jpg'),
  'generic/coast': require('./coast.jpg'),
  'generic/food': require('./food.jpg'),
  'generic/nature': require('./nature.jpg'),
  'itinerary/day-1-ubud': require('./day-1-ubud.jpg'),
  'itinerary/day-2-ubud': require('./day-2-ubud.jpg'),
  'itinerary/day-3-nusa-penida': require('./day-3-nusa-penida.jpg'),
  'itinerary/day-4-uluwatu': require('./day-4-uluwatu.jpg'),
};

/**
 * What to hand `<Image source>` for a stored value.
 *
 * Three kinds arrive here, and they are told apart rather than guessed at:
 *
 * - one of our ids, which becomes the bundled asset;
 * - an absolute URL — an OpenTripMap photograph — which becomes `{ uri }`;
 * - a URL from a *web* build (`/assets/coast-9f2a1b.jpg`), which is a trip
 *   planned in a browser and opened on a phone. Nothing here can serve it, so
 *   it falls back to a picture of the right shape rather than a grey box.
 *
 * Undefined for anything else, so a caller can decide between a placeholder
 * and no image at all.
 */
export function imageSource(value: string | undefined): ImageSourcePropType | undefined {
  if (!value) return undefined;

  const bundled = BUNDLED[value];
  if (bundled) return bundled;

  if (/^https?:/i.test(value)) return { uri: value };

  /*
   * A web build's hashed path. The file name still names the picture, so the
   * same stem match the web uses to repair its own stale URLs works here — see
   * `resolveBundledSrc`, and the note there about why the hash is not parsed.
   */
  const file = value.slice(value.lastIndexOf('/') + 1);
  const stem = Object.keys(BUNDLED).find((id) => {
    const name = id.slice(id.lastIndexOf('/') + 1);
    return file === `${name}.jpg` || file.startsWith(`${name}-`);
  });

  return stem ? BUNDLED[stem] : undefined;
}
