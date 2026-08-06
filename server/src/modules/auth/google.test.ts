import { ERROR_CODES } from '@ai-travel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../env';
import { prisma } from '../../prisma';
import { api, errorCode, refreshCookie, signUp, VALID_PASSWORD } from '../../test/harness';

/**
 * Google sign-in, with Google's half stubbed.
 *
 * `verifyIdToken` is the boundary: everything on its far side is Google's
 * signature checking, which is their code and needs a live token to exercise.
 * Everything on this side — which account a verified profile resolves to, and
 * when we refuse — is ours, and is what these tests are about.
 */

const verifyIdToken = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

type Claims = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

/** Make the next verification succeed with these claims. */
function googleReturns(claims: Claims): void {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      sub: 'google-sub-1',
      email: 'ada@example.com',
      email_verified: true,
      name: 'Ada Lovelace',
      ...claims,
    }),
  });
}

/** Make the next verification fail, as it would for a forged or stale token. */
function googleRejects(): void {
  verifyIdToken.mockRejectedValue(new Error('Invalid token signature'));
}

function signInWithGoogle(credential = 'id-token') {
  return api().post('/api/auth/google').send({ credential });
}

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  // `env()` caches at first read, which already happened at import.
  resetEnvCache();
  verifyIdToken.mockReset();
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  resetEnvCache();
});

describe('POST /api/auth/google — new account', () => {
  it('opens an account and signs in', async () => {
    googleReturns({});

    const response = await signInWithGoogle();

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(typeof response.body.accessToken).toBe('string');
    expect(refreshCookie(response)).toBeTruthy();
  });

  it('leaves the new account with no password', async () => {
    googleReturns({});
    await signInWithGoogle();

    const user = await prisma.user.findFirstOrThrow();

    expect(user.passwordHash).toBeNull();
  });

  it('records the identity against Google’s subject, not the email', async () => {
    googleReturns({});
    await signInWithGoogle();

    const identity = await prisma.authIdentity.findFirstOrThrow();

    expect(identity.provider).toBe('google');
    expect(identity.providerUserId).toBe('google-sub-1');
  });

  it('falls back to the local part when Google sends no name', async () => {
    googleReturns({ name: undefined });

    const created = await signInWithGoogle();

    expect(created.body.user.name).toBe('ada');
  });

  it('verifies the token against our own client id', async () => {
    googleReturns({});
    await signInWithGoogle('the-credential');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'the-credential',
      audience: CLIENT_ID,
    });
  });
});

describe('POST /api/auth/google — returning', () => {
  it('signs the same account back in rather than making a second one', async () => {
    googleReturns({});
    const first = await signInWithGoogle();

    googleReturns({});
    const second = await signInWithGoogle();

    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  // A Google account's email can change; the subject does not. Following the
  // email would either lose the account or hand it to whoever inherits the
  // old address.
  it('follows the subject when the email has changed', async () => {
    googleReturns({});
    const first = await signInWithGoogle();

    googleReturns({ email: 'ada.king@example.com' });
    const second = await signInWithGoogle();

    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('POST /api/auth/google — refusals', () => {
  // The whole linking policy rests on Google vouching for the address.
  it('refuses an address Google has not verified', async () => {
    googleReturns({ email_verified: false });

    const response = await signInWithGoogle();

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe(ERROR_CODES.GOOGLE_EMAIL_UNVERIFIED);
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses a token that does not verify', async () => {
    googleRejects();

    const response = await signInWithGoogle();

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.GOOGLE_TOKEN_INVALID);
  });

  it('refuses a request with no credential', async () => {
    const response = await api().post('/api/auth/google').send({});

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('reports honestly when the server has no client id', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    resetEnvCache();
    googleReturns({});

    const response = await signInWithGoogle();

    expect(response.status).toBe(503);
    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  });

  /*
   * The heart of it. Our own signups are unverified, so an attacker can
   * register an address they do not own and wait for its owner to arrive
   * through Google. Auto-linking on a matching email would hand them the
   * account, so a collision is refused and the owner links it deliberately.
   */
  it('refuses to adopt an existing password account', async () => {
    await signUp({ email: 'ada@example.com' });
    googleReturns({});

    const response = await signInWithGoogle();

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe(ERROR_CODES.GOOGLE_LINK_REQUIRED);
    expect(response.body.error.message).toContain('connect Google from your profile');
  });

  it('refuses the collision however the email is cased', async () => {
    await signUp({ email: 'ada@example.com' });
    googleReturns({ email: 'ADA@Example.com' });

    expect(errorCode(await signInWithGoogle())).toBe(ERROR_CODES.GOOGLE_LINK_REQUIRED);
  });

  it('creates no account and no identity when it refuses', async () => {
    await signUp({ email: 'ada@example.com' });
    googleReturns({});
    await signInWithGoogle();

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.authIdentity.count()).toBe(0);
  });
});

describe('linking from a signed-in account', () => {
  it('connects Google to the current account', async () => {
    const { accessToken, user } = await signUp({ email: 'ada@example.com' });
    googleReturns({});

    const response = await api()
      .post('/api/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'id-token' });

    expect(response.status).toBe(204);

    const identity = await prisma.authIdentity.findFirstOrThrow();
    expect(identity.userId).toBe(user.id);
  });

  // The point of the whole refusal path: after linking, the button works.
  it('lets the Google button work afterwards', async () => {
    const { accessToken, user } = await signUp({ email: 'ada@example.com' });
    googleReturns({});
    await api()
      .post('/api/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'id-token' });

    googleReturns({});
    const response = await signInWithGoogle();

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
  });

  it('allows a Google address different from the account’s own', async () => {
    const { accessToken } = await signUp({ email: 'ada@work.example' });
    googleReturns({ email: 'ada@personal.example' });

    const response = await api()
      .post('/api/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'id-token' });

    expect(response.status).toBe(204);
  });

  it('is idempotent', async () => {
    const { accessToken } = await signUp();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      googleReturns({});
      const response = await api()
        .post('/api/auth/google/link')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ credential: 'id-token' });

      expect(response.status).toBe(204);
    }

    expect(await prisma.authIdentity.count()).toBe(1);
  });

  it('refuses a Google account already connected elsewhere', async () => {
    googleReturns({});
    await signInWithGoogle();

    const other = await signUp({ email: 'grace@example.com' });
    googleReturns({});

    const response = await api()
      .post('/api/auth/google/link')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ credential: 'id-token' });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe(ERROR_CODES.GOOGLE_ALREADY_LINKED);
  });

  it('needs a signed-in account', async () => {
    googleReturns({});

    const response = await api().post('/api/auth/google/link').send({ credential: 'id-token' });

    expect(response.status).toBe(401);
  });
});

describe('disconnecting', () => {
  it('detaches Google from an account that still has a password', async () => {
    const { accessToken } = await signUp();
    googleReturns({});
    await api()
      .post('/api/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'id-token' });

    const response = await api()
      .delete('/api/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(204);
    expect(await prisma.authIdentity.count()).toBe(0);
  });

  // Disconnecting the only way in would lock the account shut, and there is no
  // password reset to recover with.
  it('refuses when it is the only way to sign in', async () => {
    googleReturns({});
    const session = await signInWithGoogle();

    const response = await api()
      .delete('/api/auth/google/link')
      .set('Authorization', `Bearer ${session.body.accessToken}`);

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe(ERROR_CODES.LAST_SIGN_IN_METHOD);
    expect(await prisma.authIdentity.count()).toBe(1);
  });
});

describe('password sign-in alongside Google', () => {
  /*
   * A Google-only account has no hash. `verify` throws on null, so without a
   * guard this is a 500 — and a 500 here is an oracle: it distinguishes a
   * Google-only address from an unknown one.
   */
  it('rejects a password guess against a Google-only account as bad credentials', async () => {
    googleReturns({});
    await signInWithGoogle();

    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('is indistinguishable from an unknown address', async () => {
    googleReturns({});
    await signInWithGoogle();

    const googleOnly = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });

    const unknown = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: VALID_PASSWORD });

    expect(googleOnly.status).toBe(unknown.status);
    expect(googleOnly.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('GET /api/me', () => {
  it('lists the connected providers', async () => {
    googleReturns({});
    const session = await signInWithGoogle();

    const response = await api()
      .get('/api/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`);

    expect(response.body.identities).toEqual([{ provider: 'google', email: 'ada@example.com' }]);
    expect(response.body.hasPassword).toBe(false);
  });

  it('reports an empty list for a password-only account', async () => {
    const { accessToken } = await signUp();

    const response = await api().get('/api/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.body.identities).toEqual([]);
    expect(response.body.hasPassword).toBe(true);
  });
});
