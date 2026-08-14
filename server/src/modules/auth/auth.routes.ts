import { ERROR_CODES } from '@ai-travel/shared';
import { loginSchema, registerSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../../env';
import { unauthorized, unprocessable } from '../../errors';
import { login, logout, register, rotateRefreshToken } from './auth.service';
import type { IssuedSession } from './auth.service';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from './cookies';
import { linkGoogle, signInWithGoogle, unlinkGoogle } from './google';
import { accountRateLimit, loginRateLimit, registerRateLimit } from './rate-limit';
import { requireAuth, userIdOf } from './requireAuth';

/**
 * `/api/auth`.
 *
 * The refresh cookie is scoped to this path, so these are the only routes the
 * browser ever attaches it to.
 */
export const authRouter = Router();

/**
 * How a client that cannot keep a cookie asks for the refresh token instead.
 *
 * Opt-in by header rather than sniffed from the user agent: what matters is
 * whether the caller can hold an httpOnly cookie across a cold start, and no
 * user-agent string has ever answered that question.
 */
const TRANSPORT_HEADER = 'x-refresh-transport';

/**
 * Whether to hand the refresh token back in the response body.
 *
 * **The cookie check is the security of this, not a convenience.** Without it,
 * a script injected into the web app sets one header, calls `/auth/refresh` —
 * and the browser dutifully attaches the httpOnly cookie for it — and is handed
 * the very credential that cookie exists to keep out of JavaScript's reach. A
 * fifteen-minute access token would become a month-long session.
 *
 * A browser that has signed in always presents the cookie on this path, since
 * it is scoped to `/api/auth`. So it can never be talked into body transport,
 * whatever headers it is made to send. A native client never has one.
 */
function wantsBodyToken(request: Request): boolean {
  if (typeof request.cookies?.[REFRESH_COOKIE] === 'string') return false;

  return request.get(TRANSPORT_HEADER)?.toLowerCase() === 'body';
}

function contextOf(request: Request) {
  return {
    userAgent: request.get('user-agent'),
    ip: request.ip,
    ttlHours: wantsBodyToken(request) ? env().NATIVE_SESSION_TTL_HOURS : undefined,
  };
}

/** The refresh token this request presented, by whichever route it holds one. */
function presentedRefreshToken(request: Request): string | undefined {
  const cookie: unknown = request.cookies?.[REFRESH_COOKIE];
  if (typeof cookie === 'string' && cookie) return cookie;

  const body: unknown = (request.body as { refreshToken?: unknown } | undefined)?.refreshToken;

  return typeof body === 'string' && body ? body : undefined;
}

/**
 * Exactly the fields a session response carries.
 *
 * Built by naming them rather than by spreading and deleting: the service
 * returns internal bookkeeping alongside them, and a rest-spread would put
 * whatever gets added there next into the response body by default.
 *
 * The refresh token is named too, and only when asked for — so the web
 * response is byte-identical to what it has always been.
 */
function sessionBody(issued: IssuedSession, withRefresh: boolean) {
  return {
    user: issued.user,
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
    ...(withRefresh
      ? {
          refreshToken: issued.refreshToken,
          refreshExpiresAt: issued.expiresAt.toISOString(),
        }
      : {}),
  };
}

/**
 * Hands the session back by whichever route the caller can hold it.
 *
 * One function so the three sign-in routes cannot disagree about it, and so
 * there is a single place where "set a cookie" and "return a token" are known
 * to be alternatives rather than both.
 */
function respondWithSession(
  request: Request,
  response: Response,
  issued: IssuedSession,
  status = 200,
) {
  const native = wantsBodyToken(request);

  if (!native) setRefreshCookie(response, issued.refreshToken, issued.expiresAt);

  response.status(status).json(sessionBody(issued, native));
}

/** The ID token out of a request body, or a 422 naming the field. */
function googleCredential(body: unknown): string {
  const credential = (body as { credential?: unknown } | undefined)?.credential;

  if (typeof credential !== 'string' || credential.length === 0) {
    throw unprocessable(ERROR_CODES.VALIDATION_FAILED, 'No Google sign-in was provided.');
  }

  return credential;
}

authRouter.post('/register', registerRateLimit, async (request, response) => {
  const parsed = registerSchema.safeParse(request.body);

  if (!parsed.success) {
    // A short password is the one validation failure worth naming precisely —
    // the form should say so rather than shrug.
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === 'password');
    if (passwordIssue) throw unprocessable(ERROR_CODES.WEAK_PASSWORD, passwordIssue.message);

    throw parsed.error;
  }

  const issued = await register(parsed.data, contextOf(request));

  respondWithSession(request, response, issued, 201);
});

authRouter.post('/login', loginRateLimit, accountRateLimit, async (request, response) => {
  const issued = await login(loginSchema.parse(request.body), contextOf(request));

  respondWithSession(request, response, issued);
});

/**
 * Sign in or sign up with Google.
 *
 * Rate-limited by address like `/login`. The per-account limiter does not
 * apply — this request carries no email to bucket by, and a forged token is
 * rejected without touching the database.
 */
authRouter.post('/google', loginRateLimit, async (request, response) => {
  const issued = await signInWithGoogle(googleCredential(request.body), contextOf(request));

  respondWithSession(request, response, issued);
});

authRouter.post('/google/link', requireAuth, async (request, response) => {
  await linkGoogle(userIdOf(request), googleCredential(request.body));

  response.status(204).end();
});

authRouter.delete('/google/link', requireAuth, async (request, response) => {
  await unlinkGoogle(userIdOf(request));

  response.status(204).end();
});

/*
 * Rate-limited like `/login`, which it was not before.
 *
 * On the web this endpoint is reachable only with a cookie the browser holds,
 * so guessing at it was pointless. Body transport makes the credential
 * something a caller can supply, which makes it something a caller can guess
 * at — 32 random bytes are not brute-forceable, but an unthrottled endpoint
 * that mints sessions should not be the place we find out.
 */
authRouter.post('/refresh', loginRateLimit, async (request, response) => {
  const presented = presentedRefreshToken(request);

  if (!presented) {
    throw unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Please sign in again.');
  }

  const { refreshToken, accessToken, expiresIn, expiresAt } = await rotateRefreshToken(
    presented,
    contextOf(request),
  );

  if (wantsBodyToken(request)) {
    response.json({
      accessToken,
      expiresIn,
      refreshToken,
      refreshExpiresAt: expiresAt.toISOString(),
    });
    return;
  }

  // `expiresAt` came from the token being replaced, so the refreshed cookie
  // still expires when the sign-in does rather than a full session later.
  setRefreshCookie(response, refreshToken, expiresAt);
  response.json({ accessToken, expiresIn });
});

authRouter.post('/logout', async (request, response) => {
  await logout(presentedRefreshToken(request));

  // Cleared whatever the outcome: signing out must never fail in a way that
  // leaves the cookie behind.
  clearRefreshCookie(response);
  response.status(204).end();
});
