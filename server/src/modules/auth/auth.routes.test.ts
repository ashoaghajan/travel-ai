import { ERROR_CODES } from '@ai-travel/shared';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../prisma';
import {
  api,
  credentials,
  errorCode,
  refreshCookie,
  signUp,
  VALID_PASSWORD,
} from '../../test/harness';
import { REFRESH_COOKIE } from './cookies';

describe('POST /api/auth/register', () => {
  it('creates the account and opens a session', async () => {
    const response = await api().post('/api/auth/register').send(credentials());

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      isGuest: false,
    });
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.expiresIn).toBeGreaterThan(0);
    expect(refreshCookie(response)).toContain(`${REFRESH_COOKIE}=`);
  });

  it('never returns the password hash', async () => {
    const response = await api().post('/api/auth/register').send(credentials());

    expect(JSON.stringify(response.body)).not.toContain('$argon2');
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  // Pinned as an exact set, not a subset: the service hands the route internal
  // bookkeeping alongside the session, and it must not reach the wire.
  it('returns those three fields and nothing else', async () => {
    const response = await api().post('/api/auth/register').send(credentials());

    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
    expect(Object.keys(response.body.user).sort()).toEqual([
      'activeTripId',
      'createdAt',
      'email',
      'hasPassword',
      'id',
      'identities',
      'isGuest',
      'name',
      'plan',
      'proSince',
      'settings',
    ]);
  });

  it('returns the same shape from login', async () => {
    await signUp();

    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });

    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
  });

  it('returns only a token from refresh — no user, no bookkeeping', async () => {
    const { cookie } = await signUp();

    const response = await api().post('/api/auth/refresh').set('Cookie', cookie);

    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'expiresIn']);
  });

  it('stores a hash, not the password', async () => {
    await signUp();
    const user = await prisma.user.findFirstOrThrow();

    expect(user.passwordHash).not.toBe(VALID_PASSWORD);
    expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a second account on the same email', async () => {
    await signUp();
    const response = await api().post('/api/auth/register').send(credentials());

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe(ERROR_CODES.EMAIL_TAKEN);
  });

  // The unique constraint is on `emailKey`, so casing and padding cannot be
  // used to register the same address twice.
  it('treats a differently-cased email as the same account', async () => {
    await signUp({ email: 'ada@example.com' });
    const response = await api()
      .post('/api/auth/register')
      .send(credentials({ email: '  ADA@Example.COM  ' }));

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe(ERROR_CODES.EMAIL_TAKEN);
  });

  it('keeps the casing the user typed', async () => {
    await signUp({ email: 'Ada@Example.com' });
    const user = await prisma.user.findFirstOrThrow();

    expect(user.email).toBe('Ada@Example.com');
    expect(user.emailKey).toBe('ada@example.com');
  });

  it('names the password rule when the password is too short', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send(credentials({ password: 'short' }));

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe(ERROR_CODES.WEAK_PASSWORD);
    expect(response.body.error.message).toContain('10 characters');
  });

  it('reports other invalid fields by name', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send(credentials({ email: 'not-an-email' }));

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(response.body.error.details).toHaveProperty('email');
  });
});

describe('POST /api/auth/login', () => {
  it('opens a session for the right password', async () => {
    await signUp();
    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('ada@example.com');
    expect(refreshCookie(response)).toBeTruthy();
  });

  it('accepts the email in any casing', async () => {
    await signUp();
    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'ADA@EXAMPLE.COM', password: VALID_PASSWORD });

    expect(response.status).toBe(200);
  });

  // Distinguishing the two would confirm which addresses hold accounts.
  it('says the same thing for a wrong password and an unknown email', async () => {
    await signUp();

    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'not-the-password' });

    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: VALID_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(errorCode(wrongPassword)).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    expect(errorCode(unknownEmail)).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });
});

describe('POST /api/auth/refresh', () => {
  it('mints a new access token and rotates the cookie', async () => {
    const { cookie } = await signUp();

    const response = await api().post('/api/auth/refresh').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(typeof response.body.accessToken).toBe('string');
    expect(refreshCookie(response)).not.toBe(cookie);
  });

  it('refuses a request with no cookie', async () => {
    const response = await api().post('/api/auth/refresh');

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a cookie we never issued', async () => {
    const response = await api()
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=not-a-real-token`);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses an expired token', async () => {
    const { cookie } = await signUp();

    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await api().post('/api/auth/refresh').set('Cookie', cookie);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  // The absolute cap, and the only test that distinguishes it from the sliding
  // window it replaced: under a sliding window every one of these refreshes
  // would push the deadline out and the last one would succeed.
  it('does not let refreshing extend the session past its deadline', async () => {
    const { cookie } = await signUp();

    const deadline = (await prisma.refreshToken.findFirstOrThrow()).expiresAt;

    let current = cookie;
    for (let i = 0; i < 3; i += 1) {
      const rotated = await api().post('/api/auth/refresh').set('Cookie', current);

      expect(rotated.status).toBe(200);
      current = refreshCookie(rotated);

      // Every token minted along the way carries the original deadline.
      const issued = await prisma.refreshToken.findFirstOrThrow({
        orderBy: { createdAt: 'desc' },
      });
      expect(issued.expiresAt.getTime()).toBe(deadline.getTime());
    }

    // Now stand at the far side of the deadline. Nothing in the family works.
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const afterwards = await api().post('/api/auth/refresh').set('Cookie', current);

    expect(afterwards.status).toBe(401);
    expect(errorCode(afterwards)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  // The browser has to agree with the database about when the session ends. If
  // the cookie outlives the row, the reader keeps sending a cookie that can
  // only ever be refused; if it dies first, they are signed out early.
  it('expires the cookie with the session rather than a fresh window later', async () => {
    const { cookie } = await signUp();

    // A deadline far enough from `now + SESSION_TTL_HOURS` that a cookie built
    // from a fresh window instead of the inherited one cannot pass by accident.
    const deadline = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.refreshToken.updateMany({ data: { expiresAt: deadline } });

    const rotated = await api().post('/api/auth/refresh').set('Cookie', cookie);

    const header = rotated.headers['set-cookie'];
    const cookies = Array.isArray(header) ? header : [header];
    const found = cookies.find((value) => value?.startsWith(`${REFRESH_COOKIE}=`));
    const expires = new Date(/Expires=([^;]+)/i.exec(found ?? '')?.[1] ?? '').getTime();

    // Whole seconds only in a cookie, hence the second of slack.
    expect(Math.abs(expires - deadline.getTime())).toBeLessThanOrEqual(1000);
  });

  // Two tabs waking together send the same cookie milliseconds apart. That is
  // not theft, and signing both out would be the wrong answer.
  it('lets a just-rotated token through inside the grace window', async () => {
    const { cookie } = await signUp();

    const first = await api().post('/api/auth/refresh').set('Cookie', cookie);
    const second = await api().post('/api/auth/refresh').set('Cookie', cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(refreshCookie(second)).not.toBe(refreshCookie(first));
  });

  it('survives several tabs refreshing at once', async () => {
    const { cookie } = await signUp();

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => api().post('/api/auth/refresh').set('Cookie', cookie)),
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  });

  // Past the window there is no innocent explanation: someone kept a copy.
  it('kills the whole family when a long-dead token is replayed', async () => {
    const { cookie } = await signUp();

    const rotated = await api().post('/api/auth/refresh').set('Cookie', cookie);
    const freshCookie = refreshCookie(rotated);

    // Age the revocation past the grace window.
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const replay = await api().post('/api/auth/refresh').set('Cookie', cookie);

    expect(replay.status).toBe(401);
    expect(errorCode(replay)).toBe(ERROR_CODES.REFRESH_REUSED);

    // The token the honest user was holding is now dead too — that is the point.
    const afterwards = await api().post('/api/auth/refresh').set('Cookie', freshCookie);
    expect(afterwards.status).toBe(401);
  });

  it('leaves another device signed in when one family dies', async () => {
    const first = await signUp();
    const secondLogin = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });
    const secondCookie = refreshCookie(secondLogin);

    await api().post('/api/auth/refresh').set('Cookie', first.cookie);
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await api().post('/api/auth/refresh').set('Cookie', first.cookie);

    const other = await api().post('/api/auth/refresh').set('Cookie', secondCookie);
    expect(other.status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { cookie } = await signUp();

    const response = await api().post('/api/auth/logout').set('Cookie', cookie);

    expect(response.status).toBe(204);
    expect(refreshCookie(response).endsWith('=')).toBe(true);

    const afterwards = await api().post('/api/auth/refresh').set('Cookie', cookie);
    expect(afterwards.status).toBe(401);
  });

  it('succeeds even with no session to end', async () => {
    await expect(api().post('/api/auth/logout')).resolves.toMatchObject({ status: 204 });
  });

  it('leaves other devices signed in', async () => {
    const first = await signUp();
    const second = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });

    await api().post('/api/auth/logout').set('Cookie', first.cookie);

    const other = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(second));
    expect(other.status).toBe(200);
  });
});

/**
 * Body transport, for a client that cannot hold a cookie.
 *
 * The rotation, reuse detection and family revocation underneath are the same
 * code either way — what these pin is which door the token comes out of, and
 * the one rule that makes the difference safe.
 */
describe('native refresh transport', () => {
  const NATIVE = ['x-refresh-transport', 'body'] as const;

  it('returns the refresh token in the body when a native client asks', async () => {
    const response = await api()
      .post('/api/auth/register')
      .set(...NATIVE)
      .send(credentials());

    expect(response.status).toBe(201);
    expect(typeof response.body.refreshToken).toBe('string');
    expect(response.body.refreshToken.length).toBeGreaterThan(20);
    expect(Date.parse(response.body.refreshExpiresAt)).not.toBeNaN();

    // The token went to the body *instead of* the cookie, not as well as.
    // Read from the raw header: the harness's helper throws when absent, and
    // absence is exactly what this asserts.
    const cookies = response.headers['set-cookie'] ?? [];
    expect(cookies.some((cookie: string) => cookie.startsWith(`${REFRESH_COOKIE}=`))).toBe(false);
  });

  it('still answers the web exactly as before', async () => {
    const response = await api().post('/api/auth/register').send(credentials());

    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(response.body).not.toHaveProperty('refreshExpiresAt');
    expect(refreshCookie(response)).toContain(`${REFRESH_COOKIE}=`);
  });

  it('refreshes from the body and rotates as usual', async () => {
    const registered = await api()
      .post('/api/auth/register')
      .set(...NATIVE)
      .send(credentials());

    const first = registered.body.refreshToken as string;

    const refreshed = await api()
      .post('/api/auth/refresh')
      .set(...NATIVE)
      .send({ refreshToken: first });

    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe('string');
    // Rotation is rotation whichever door the token came through.
    expect(refreshed.body.refreshToken).not.toBe(first);
  });

  it('detects reuse of a rotated body token, and kills the family', async () => {
    const registered = await api()
      .post('/api/auth/register')
      .set(...NATIVE)
      .send(credentials());

    const first = registered.body.refreshToken as string;

    await api()
      .post('/api/auth/refresh')
      .set(...NATIVE)
      .send({ refreshToken: first })
      .expect(200);

    // Past the five-second grace window this is a stolen token being replayed.
    await new Promise((resolve) => setTimeout(resolve, 5_100));

    const replayed = await api()
      .post('/api/auth/refresh')
      .set(...NATIVE)
      .send({ refreshToken: first });

    expect(replayed.status).toBe(401);
    expect(errorCode(replayed)).toBe(ERROR_CODES.REFRESH_REUSED);
  }, 20_000);

  it('logs out from a body token', async () => {
    const registered = await api()
      .post('/api/auth/register')
      .set(...NATIVE)
      .send(credentials());

    const token = registered.body.refreshToken as string;

    await api()
      .post('/api/auth/logout')
      .set(...NATIVE)
      .send({ refreshToken: token })
      .expect(204);

    await api()
      .post('/api/auth/refresh')
      .set(...NATIVE)
      .send({ refreshToken: token })
      .expect(401);
  });

  it('gives a native sign-in the longer session cap', async () => {
    const native = await api()
      .post('/api/auth/register')
      .set(...NATIVE)
      .send(credentials({ email: 'native@example.com' }));

    const web = await api()
      .post('/api/auth/register')
      .send(credentials({ email: 'web@example.com' }));

    const nativeRow = await prisma.refreshToken.findFirstOrThrow({
      where: { user: { emailKey: 'native@example.com' } },
    });
    const webRow = await prisma.refreshToken.findFirstOrThrow({
      where: { user: { emailKey: 'web@example.com' } },
    });

    expect(native.status).toBe(201);
    expect(web.status).toBe(201);
    // Six hours on a browser tab is right; on a home screen it asks for a
    // password twice a day.
    expect(nativeRow.expiresAt.getTime()).toBeGreaterThan(webRow.expiresAt.getTime());
  });

  /**
   * The rule the whole design rests on.
   *
   * A script injected into the web app can set any header it likes. What it
   * cannot do is stop the browser attaching the httpOnly cookie — so the
   * presence of that cookie is proof the caller is a browser, and proof that
   * handing it the refresh token would be handing it to whatever is running in
   * the page.
   */
  it('refuses body transport to anything already holding the cookie', async () => {
    const registered = await api().post('/api/auth/register').send(credentials());
    const cookie = refreshCookie(registered);

    const escalated = await api()
      .post('/api/auth/refresh')
      .set(...NATIVE)
      .set('Cookie', cookie as string)
      .send();

    expect(escalated.status).toBe(200);
    // An XSS that asks nicely still gets fifteen minutes, not thirty days.
    expect(escalated.body).not.toHaveProperty('refreshToken');
    expect(refreshCookie(escalated)).toContain(`${REFRESH_COOKIE}=`);
  });
});
