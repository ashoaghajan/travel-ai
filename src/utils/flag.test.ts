import { describe, expect, it } from 'vitest';
import { flagOf } from './flag';

describe('flagOf', () => {
  it('turns an alpha-2 code into its flag', () => {
    expect(flagOf('ES')).toBe('🇪🇸');
    expect(flagOf('JP')).toBe('🇯🇵');
  });

  it('accepts a lower-case code', () => {
    expect(flagOf('am')).toBe(flagOf('AM'));
  });

  // Two code points, one glyph. Asserting the length keeps a future "fix" from
  // quietly returning the letters themselves.
  it('returns a surrogate pair, not the letters', () => {
    expect([...flagOf('FR')]).toHaveLength(2);
    expect(flagOf('FR')).not.toBe('FR');
  });

  it.each(['', 'E', 'ESP', 'E1', '12', 'e s'])('returns nothing for %o', (code) => {
    expect(flagOf(code)).toBe('');
  });
});
