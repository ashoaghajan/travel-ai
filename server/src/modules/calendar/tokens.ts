import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../env';
import { HttpError } from '../../errors';
import { ERROR_CODES } from '@ai-travel/shared';

/**
 * Refresh tokens, encrypted at rest.
 *
 * A Google refresh token is not like the session tokens elsewhere in this
 * server. Ours are short-lived or revocable — signing out kills a whole family
 * — but this one stays valid until the reader revokes it inside their own
 * Google account, and it grants writing to their calendar for as long as it
 * does. A database dump that leaked one would be a real breach rather than an
 * inconvenience, so the column holds ciphertext.
 *
 * AES-256-GCM, which authenticates as well as encrypts: a row somebody edited
 * fails to decrypt rather than decrypting to something else. The nonce is
 * random per encryption and travels with the ciphertext, because reusing one
 * under the same key is the way GCM breaks.
 */

const ALGORITHM = 'aes-256-gcm';
/** 96 bits, which is the size GCM is defined for. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

function key(): Buffer {
  const configured = env().CALENDAR_TOKEN_KEY;

  if (!configured) {
    throw new HttpError(
      503,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      'This server has no CALENDAR_TOKEN_KEY, so calendar connections cannot be stored.',
    );
  }

  const bytes = Buffer.from(configured, 'base64url');

  if (bytes.length !== KEY_BYTES) {
    throw new HttpError(
      503,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      `CALENDAR_TOKEN_KEY must decode to ${KEY_BYTES} bytes; this one is ${bytes.length}.`,
    );
  }

  return bytes;
}

/**
 * `iv.ciphertext.tag`, each base64url.
 *
 * One column rather than three: the three are meaningless apart, and a schema
 * that can hold a nonce without its ciphertext is a schema with a state nobody
 * has thought about.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [iv, encrypted, cipher.getAuthTag()]
    .map((part) => part.toString('base64url'))
    .join('.');
}

/**
 * The token back, or null if this row cannot be read.
 *
 * Null rather than a throw, and it is the more useful answer: the causes are a
 * rotated key and a corrupted row, and the app's response to both is the same
 * — treat the account as not connected and offer to connect it again. That is
 * two taps for the reader. Throwing would turn a rotated key into a 500 on
 * every calendar request instead.
 */
export function decryptToken(stored: string): string | null {
  const parts = stored.split('.');
  if (parts.length !== 3) return null;

  try {
    const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== IV_BYTES) return null;

    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // A wrong key, a truncated row, a tampered tag: all indistinguishable here
    // and all mean the same thing to the caller.
    return null;
  }
}
