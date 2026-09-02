import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../env';
import { decryptToken, encryptToken } from './tokens';

const KEY = randomBytes(32).toString('base64url');

describe('calendar token storage', () => {
  // `env()` parses once and caches, so the key has to be set *and* the cache
  // dropped for a test to change it.
  function useKey(value?: string) {
    if (value) process.env.CALENDAR_TOKEN_KEY = value;
    else delete process.env.CALENDAR_TOKEN_KEY;
    resetEnvCache();
  }

  beforeEach(() => {
    useKey(KEY);
  });

  afterAll(() => {
    useKey(undefined);
  });

  it('round-trips a token', () => {
    const token = '1//0abcdefgHIJKLMNOP-qrstuvwxyz_0123456789';

    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it('never stores the plaintext', () => {
    const token = 'a-very-secret-refresh-token';

    expect(encryptToken(token)).not.toContain(token);
  });

  it('uses a fresh nonce, so the same token encrypts differently each time', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });

  it('refuses a row whose ciphertext was edited', () => {
    const [iv, encrypted, tag] = encryptToken('token').split('.');
    const flipped = Buffer.from(encrypted, 'base64url');
    flipped[0] ^= 0xff;

    expect(decryptToken([iv, flipped.toString('base64url'), tag].join('.'))).toBeNull();
  });

  it('refuses a row whose tag was edited', () => {
    const [iv, encrypted] = encryptToken('token').split('.');
    const forged = randomBytes(16).toString('base64url');

    expect(decryptToken([iv, encrypted, forged].join('.'))).toBeNull();
  });

  it('reads a rotated key as "not connected" rather than throwing', () => {
    const stored = encryptToken('token');
    useKey(randomBytes(32).toString('base64url'));

    expect(decryptToken(stored)).toBeNull();
  });

  it.each(['', 'not-encrypted', 'a.b'])('refuses a malformed row: %s', (stored) => {
    expect(decryptToken(stored)).toBeNull();
  });

  it('refuses to encrypt without a key', () => {
    useKey(undefined);

    expect(() => encryptToken('token')).toThrow(/CALENDAR_TOKEN_KEY/);
  });

  it('refuses a key that is the wrong length', () => {
    // 33 bytes encodes to 44 characters, so it clears the schema's length
    // floor and still fails the size check this is about.
    useKey(randomBytes(33).toString('base64url'));

    expect(() => encryptToken('token')).toThrow(/32 bytes/);
  });
});
