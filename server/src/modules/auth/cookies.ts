import type { CookieOptions, Response } from 'express';
import { isProduction } from '../../env';

/** The cookie name is short because it is sent on every `/api/auth` call. */
export const REFRESH_COOKIE = 'rt';

/**
 * Where the refresh cookie may go, and who may read it.
 *
 * `httpOnly` keeps it away from any script, including an injected one.
 * `Path=/api/auth` means it is not attached to ordinary API calls at all, so
 * it is only ever in flight on the three endpoints that consume it.
 * `SameSite=Lax` blocks it from cross-site POSTs, which is what closes CSRF —
 * and the access token, being attached by hand, has no CSRF surface to begin
 * with.
 *
 * `Secure` follows `NODE_ENV` because some browsers refuse `Secure` cookies
 * over plain `http://localhost`, which would make development impossible. No
 * `Domain` is ever set: a host-only cookie cannot leak to a sibling subdomain.
 */
function options(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api/auth',
  };
}

/**
 * `expiresAt` is the session's deadline, not a fresh window per call.
 *
 * A rotation hands back the same instant it was given, so the cookie the
 * browser holds after five refreshes still dies when the sign-in was always
 * going to die. Expressed as `Expires` rather than `Max-Age` for that reason:
 * the deadline is a point in time, and re-deriving a duration from it on every
 * rotation is how an absolute cap quietly turns back into a sliding one.
 */
export function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(REFRESH_COOKIE, token, { ...options(), expires: expiresAt });
}

export function clearRefreshCookie(response: Response): void {
  // Must match the original attributes or the browser keeps the old cookie.
  response.clearCookie(REFRESH_COOKIE, options());
}
