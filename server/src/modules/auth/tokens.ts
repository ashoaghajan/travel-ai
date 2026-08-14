import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@ai-travel/shared';
import jwt from 'jsonwebtoken';
import { env } from '../../env';
import { unauthorized } from '../../errors';

/**
 * The two tokens, and why they are different animals.
 *
 * The **access token** is a signed JWT the client holds in memory and attaches
 * by hand. It is short-lived because nothing can revoke it — the only defence
 * against a stolen one is that it stops working shortly.
 *
 * The **refresh token** is 32 opaque random bytes in an httpOnly cookie. It is
 * not a JWT: there is nothing to read in it, and we want the database to be
 * the authority on whether it is still live, which a self-describing token
 * cannot give us. Only its sha256 is stored, so a dumped database yields
 * nothing replayable.
 */

export type AccessTokenPayload = { sub: string };

export function signAccessToken(userId: string): { token: string; expiresIn: number } {
  const { JWT_SECRET, ACCESS_TOKEN_TTL_SECONDS } = env();

  const token = jwt.sign({ sub: userId } satisfies AccessTokenPayload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });

  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * The user id inside a valid access token.
 *
 * Expiry is reported separately from every other failure: the client retries a
 * refresh only for `TOKEN_EXPIRED`, and treating a forged signature the same
 * way would have it burn a refresh on an attacker's behalf.
 */
export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, env().JWT_SECRET) as AccessTokenPayload;
    if (!payload.sub) throw unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');

    return payload.sub;
  } catch (caught) {
    if (caught instanceof jwt.TokenExpiredError) {
      throw unauthorized(ERROR_CODES.TOKEN_EXPIRED, 'Your session needs refreshing.');
    }

    throw unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');
  }
}

/** A new refresh token: the value for the cookie, and the hash for the row. */
export function createRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newFamilyId(): string {
  return randomUUID();
}

/**
 * When a session opened now must end.
 *
 * Called once per sign-in. A rotation deliberately does *not* call it — it
 * carries the deadline of the token it replaced, which is what makes the cap
 * absolute rather than sliding.
 */
export function sessionExpiry(now: Date = new Date(), hours?: number): Date {
  return new Date(now.getTime() + (hours ?? env().SESSION_TTL_HOURS) * 60 * 60 * 1000);
}
