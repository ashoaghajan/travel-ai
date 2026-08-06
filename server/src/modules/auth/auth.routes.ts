import { ERROR_CODES } from '@ai-travel/shared';
import { loginSchema, registerSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request } from 'express';
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

function contextOf(request: Request) {
  return { userAgent: request.get('user-agent'), ip: request.ip };
}

/**
 * Exactly the three fields a session response carries.
 *
 * Built by naming them rather than by spreading and deleting: the service
 * returns internal bookkeeping alongside them, and a rest-spread would put
 * whatever gets added there next into the response body by default.
 */
function sessionBody(issued: IssuedSession) {
  return { user: issued.user, accessToken: issued.accessToken, expiresIn: issued.expiresIn };
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

  setRefreshCookie(response, issued.refreshToken, issued.expiresAt);
  response.status(201).json(sessionBody(issued));
});

authRouter.post('/login', loginRateLimit, accountRateLimit, async (request, response) => {
  const issued = await login(loginSchema.parse(request.body), contextOf(request));

  setRefreshCookie(response, issued.refreshToken, issued.expiresAt);
  response.json(sessionBody(issued));
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

  setRefreshCookie(response, issued.refreshToken, issued.expiresAt);
  response.json(sessionBody(issued));
});

authRouter.post('/google/link', requireAuth, async (request, response) => {
  await linkGoogle(userIdOf(request), googleCredential(request.body));

  response.status(204).end();
});

authRouter.delete('/google/link', requireAuth, async (request, response) => {
  await unlinkGoogle(userIdOf(request));

  response.status(204).end();
});

authRouter.post('/refresh', async (request, response) => {
  const cookie: unknown = request.cookies?.[REFRESH_COOKIE];

  if (typeof cookie !== 'string' || !cookie) {
    throw unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Please sign in again.');
  }

  const { refreshToken, accessToken, expiresIn, expiresAt } = await rotateRefreshToken(
    cookie,
    contextOf(request),
  );

  // `expiresAt` came from the token being replaced, so the refreshed cookie
  // still expires when the sign-in does rather than a full session later.
  setRefreshCookie(response, refreshToken, expiresAt);
  response.json({ accessToken, expiresIn });
});

authRouter.post('/logout', async (request, response) => {
  const cookie: unknown = request.cookies?.[REFRESH_COOKIE];

  await logout(typeof cookie === 'string' ? cookie : undefined);

  // Cleared whatever the outcome: signing out must never fail in a way that
  // leaves the cookie behind.
  clearRefreshCookie(response);
  response.status(204).end();
});
