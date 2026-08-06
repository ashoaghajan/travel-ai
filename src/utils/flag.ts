/**
 * Flag emoji from an ISO 3166-1 alpha-2 code.
 *
 * No lookup table and no network call: a flag emoji *is* its country code,
 * written in regional indicator symbols. "ES" becomes U+1F1EA U+1F1F8, which
 * every font that has flags at all renders as one glyph. The country list
 * already carries the code (`country.service.ts`), so this costs nothing.
 *
 * The catch is Windows: Chrome and Edge there ship no flag glyphs, so the pair
 * falls back to the letters "ES" rather than to tofu. That is why callers put
 * the flag *before* the country name and never in place of it — on the browsers
 * that cannot draw it, the label still reads correctly.
 *
 * The larger cost, and a deliberate one: a leading flag disables the native
 * `<select>` typeahead. Chrome matches a typed letter against position 0 of the
 * label, which is now an emoji, so pressing "a" no longer jumps to Afghanistan
 * in a list of 200-odd countries. Measured, not assumed — stripping the flags
 * restores it, and moving them *after* the name restores it too. Trailing flags
 * are therefore the fix if this is ever reconsidered; the leading position was
 * chosen for how the column reads, knowing what it costs.
 */

/** Distance from an ASCII capital to its regional indicator. */
const REGIONAL_INDICATOR_OFFSET = 0x1f1a5;

const ALPHA_2 = /^[A-Za-z]{2}$/;

/**
 * `flagOf('es')` → `'🇪🇸'`. Anything that is not two letters returns an empty
 * string: a malformed code should cost the reader a missing flag, not a pair
 * of stray symbols beside a country that is otherwise fine.
 */
export function flagOf(code: string): string {
  if (!ALPHA_2.test(code)) return '';

  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((letter) => letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET),
  );
}
