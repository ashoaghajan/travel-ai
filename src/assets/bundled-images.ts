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

/* ------------------------------------------------- reading a stored picture */

/**
 * The file name each id is known by, longest first.
 *
 * Longest first so the most specific stem wins: were there ever both `day-1`
 * and `day-1-ubud`, matching the short one against `day-1-ubud.jpg` would
 * quietly resolve the wrong photograph.
 *
 * A stem that two ids share is dropped rather than guessed at. Nothing
 * collides today — the check exists so that adding `itinerary/city` beside
 * `generic/city` later fails visibly here instead of silently swapping
 * pictures.
 */
const STEMS: readonly { stem: string; id: string }[] = (() => {
  const counts = new Map<string, number>();
  const entries = Object.keys(BUNDLED_IMAGES).map((id) => {
    const stem = id.slice(id.lastIndexOf('/') + 1);
    counts.set(stem, (counts.get(stem) ?? 0) + 1);

    return { stem, id };
  });

  return entries
    .filter((entry) => counts.get(entry.stem) === 1)
    .sort((a, b) => b.stem.length - a.stem.length);
})();

/**
 * A stored image URL, translated into one this build can actually serve.
 *
 * The problem it exists for: what gets written to the database is whatever URL
 * the build that wrote it resolved an asset import to — `/src/assets/generic/
 * city.jpg` from a dev server, `/assets/city-Dtv_IcUv.jpg` from a production
 * build, and a different hash again after any deploy that changes the file.
 * One database serves both, so a trip made in dev shows broken thumbnails in
 * the built app, and a trip made against one deploy breaks on the next.
 *
 * `tripFile.ts` already solves this for a trip crossing between installs, by
 * carrying the id in the file. This is the same idea one layer down, for a
 * trip that never moves: match a stored path back to its id by file name, and
 * hand back whatever *this* build calls it.
 *
 * Matching on the name rather than the hash is deliberate. A Vite hash is
 * base64url and can itself contain a hyphen — `nature-MTN-2l84.jpg` — so
 * "everything before the last hyphen" would answer `nature-MTN`. Asking
 * instead whether the file name is `<stem>.jpg` or begins `<stem>-` has no
 * such trap.
 *
 * Anything unrecognised is returned untouched: an OpenTripMap photograph, a
 * category fallback, an empty string. This only ever repairs its own.
 */
export function resolveBundledSrc(src: string | undefined): string | undefined {
  if (!src) return src;

  // Already this build's. The common case, and it costs one lookup.
  if (bundledImageId(src) !== undefined) return src;

  /*
   * A stable id rather than a URL, which is what the mobile app stores.
   *
   * React Native resolves an asset import to an opaque module reference, not a
   * string, so a phone cannot store "this build's URL" — there is no such
   * thing. It stores the id instead, and this is where the web reads one.
   *
   * Ahead of the stem matching below because it is exact: `generic/coast` has
   * no `.jpg`, so the file-name rules would not match it and the picture would
   * come back broken on every trip planned on a phone.
   */
  const byId = bundledImageSrc(src);
  if (byId !== undefined) return byId;

  // Only ever our own paths — an absolute URL belongs to somebody else.
  if (/^[a-z][a-z\d+.-]*:/i.test(src)) return src;

  const path = src.split(/[?#]/)[0];
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (!file) return src;

  const match = STEMS.find(
    ({ stem }) => file === `${stem}.jpg` || file.startsWith(`${stem}-`),
  );

  return match ? BUNDLED_IMAGES[match.id] : src;
}
