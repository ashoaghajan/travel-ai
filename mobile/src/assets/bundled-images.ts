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
  /*
   * The four real properties in `mock/hotels.ts`, which are the sample stays
   * the app falls back to when no rate provider answers. They keep their own
   * photographs rather than borrowing the scenery above: these are named
   * hotels, and a landscape captioned "Komaneka at Bisma" claims something we
   * would not know. `lodging-images.ts` is the opposite case and says so.
   */
  'hotels/komaneka': require('./komaneka.jpg'),
  'hotels/alaya': require('./alaya.jpg'),
  'hotels/ubud-village': require('./ubud-village.jpg'),
  'hotels/element': require('./element.jpg'),
};

/**
 * Who is asking, for the hosts that require an answer.
 *
 * Attraction photographs come from `upload.wikimedia.org`, which enforces a
 * User-Agent policy: a request that identifies no application is answered
 * `403`. A browser passes it without trying, which is why the web has never
 * needed this and the phone did — React Native's `<Image>` goes through
 * Fresco and OkHttp on Android, so every photo was requested as `okhttp/4.x`
 * and refused. `ActivityCard` did what it is meant to do with a failed load
 * and drew the category artwork, so the screens looked like a set of stock
 * photographs rather than like a bug.
 *
 * https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
 * asks for an application name and somewhere to look it up, which is what
 * this is — not a browser string. Spoofing one would work and would be a lie
 * to a host generous enough to serve the pictures for free.
 *
 * Sent to every remote image host, not just Wikimedia: OpenTripMap previews
 * arrive the same way, and a rule that says "identify yourself except when
 * you think you can get away with it" is not worth the branch.
 */
const REMOTE_IMAGE_HEADERS = {
  'User-Agent': 'AiTravel/1.0 (+https://travel-ai-io1t.onrender.com)',
} as const;

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

  /*
   * A one-element array, not the bare object it looks like it should be.
   * `Image.android.js` lifts `headers` out of the source and onto the native
   * `headers` prop — which is the only place `ReactImageManager` reads them
   * from — and it does that lifting inside `if (Array.isArray(source))`. A
   * single object takes the branch below it, which destructures `uri`, `width`
   * and `height` and silently drops everything else. The header is then in the
   * props React sees and in no request Fresco makes.
   *
   * The array is the same picture either way: RN treats a multi-source array
   * as candidate resolutions to pick between, and with one candidate there is
   * nothing to pick.
   */
  if (/^https?:/i.test(value)) return [{ uri: value, headers: REMOTE_IMAGE_HEADERS }];

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
