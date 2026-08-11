import { describe, expect, it } from 'vitest';
import { BUNDLED_IMAGES, bundledImageId, bundledImageSrc, resolveBundledSrc } from './bundled-images';

/**
 * Reading back a picture somebody else's build wrote down.
 *
 * The database holds whatever URL the build that saved a trip resolved an
 * asset import to. One database serves the dev server and the built app, and
 * a deploy changes the hashes — so the stored URL is right for exactly one
 * build and wrong for every other, which shows up as a broken thumbnail on a
 * trip that was fine yesterday.
 *
 * Worth knowing while reading these: vitest resolves an asset import the way
 * the dev server does, so `BUNDLED_IMAGES` here holds `/src/assets/…` paths.
 * The dev-path cases below are therefore already-correct inputs in *this*
 * environment and carry little weight; the hashed `/assets/name-HASH.jpg`
 * cases are the ones exercising the repair. Under a production build the two
 * swap roles, which is why both shapes are asserted for every picture.
 */

const CITY = BUNDLED_IMAGES['generic/city'];
const NATURE = BUNDLED_IMAGES['generic/nature'];
const DAY_ONE = BUNDLED_IMAGES['itinerary/day-1-ubud'];

describe('resolveBundledSrc', () => {
  it('leaves this build’s own URL alone', () => {
    expect(resolveBundledSrc(CITY)).toBe(CITY);
  });

  it('repairs a dev server path', () => {
    // What a trip created against `npm run dev` actually stores.
    expect(resolveBundledSrc('/src/assets/generic/city.jpg')).toBe(CITY);
  });

  it('repairs a hashed path from some other build', () => {
    expect(resolveBundledSrc('/assets/city-Dtv_IcUv.jpg')).toBe(CITY);
  });

  /*
   * The reason this matches on the name and not on the hash. A Vite hash is
   * base64url and can contain a hyphen, so "everything before the last one"
   * would answer `nature-MTN` and resolve nothing.
   */
  it('repairs a hash that itself contains a hyphen', () => {
    expect(resolveBundledSrc('/assets/nature-MTN-2l84.jpg')).toBe(NATURE);
  });

  it('repairs a name whose own stem contains hyphens', () => {
    expect(resolveBundledSrc('/assets/day-1-ubud-BFMX5g2F.jpg')).toBe(DAY_ONE);
    expect(resolveBundledSrc('/src/assets/itinerary/day-1-ubud.jpg')).toBe(DAY_ONE);
  });

  it('does not confuse one itinerary day for another', () => {
    expect(resolveBundledSrc('/assets/day-3-nusa-penida-U0i2ia9x.jpg')).toBe(
      BUNDLED_IMAGES['itinerary/day-3-nusa-penida'],
    );
  });

  it('ignores a query string a dev server may have added', () => {
    expect(resolveBundledSrc('/src/assets/generic/city.jpg?t=1786433769406')).toBe(CITY);
  });

  it('leaves somebody else’s photograph untouched', () => {
    const external = 'https://images.opentripmap.com/x/city.jpg';

    // Only our own paths are ours to rewrite — and this one happens to end in
    // a name we know, which is exactly the case that must not be rewritten.
    expect(resolveBundledSrc(external)).toBe(external);
  });

  it('leaves an unrecognised local path untouched', () => {
    expect(resolveBundledSrc('/assets/hero-travel-B2-y-Bi4.jpg')).toBe(
      '/assets/hero-travel-B2-y-Bi4.jpg',
    );
  });

  it('passes an absent image through rather than inventing one', () => {
    expect(resolveBundledSrc(undefined)).toBeUndefined();
    expect(resolveBundledSrc('')).toBe('');
  });

  it('resolves every picture it ships, from either shape of path', () => {
    for (const [id, src] of Object.entries(BUNDLED_IMAGES)) {
      const stem = id.slice(id.lastIndexOf('/') + 1);

      expect(resolveBundledSrc(`/src/assets/${id}.jpg`)).toBe(src);
      expect(resolveBundledSrc(`/assets/${stem}-A1b2C3d4.jpg`)).toBe(src);
    }
  });
});

describe('the id table', () => {
  it('round-trips every picture through its id', () => {
    for (const [id, src] of Object.entries(BUNDLED_IMAGES)) {
      expect(bundledImageId(src)).toBe(id);
      expect(bundledImageSrc(id)).toBe(src);
    }
  });

  it('gives every picture a file name of its own', () => {
    // Two ids sharing a stem cannot be told apart by a stored path, so
    // `resolveBundledSrc` refuses to guess. This is the check that says so
    // out loud rather than letting a future addition swap two photographs.
    const stems = Object.keys(BUNDLED_IMAGES).map((id) => id.slice(id.lastIndexOf('/') + 1));

    expect(new Set(stems).size).toBe(stems.length);
  });
});
