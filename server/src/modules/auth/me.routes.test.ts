import { ERROR_CODES } from '@ai-travel/shared';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../env';
import { prisma } from '../../prisma';
import { api, errorCode, signUp } from '../../test/harness';

/** A token that was validly signed but has already lapsed. */
function expiredToken(userId: string): string {
  return jwt.sign({ sub: userId }, env().JWT_SECRET, { expiresIn: -10 });
}

describe('GET /api/me', () => {
  it('returns the account behind the token', async () => {
    const { accessToken, user } = await signUp();

    const response = await api().get('/api/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: user.id, email: 'ada@example.com', isGuest: false });
  });

  it('never exposes the password hash', async () => {
    const { accessToken } = await signUp();

    const response = await api().get('/api/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });

  it('refuses a request with no token', async () => {
    const response = await api().get('/api/me');

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a token that is not a Bearer token', async () => {
    const { accessToken } = await signUp();
    const response = await api().get('/api/me').set('Authorization', accessToken);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a forged signature', async () => {
    const forged = jwt.sign({ sub: 'u_1' }, 'not-the-real-secret-but-long-enough-xxxx');

    const response = await api().get('/api/me').set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  // The client refreshes only on TOKEN_EXPIRED. Reporting a forged token the
  // same way would have it spend a refresh on an attacker's behalf.
  it('distinguishes an expired token from an invalid one', async () => {
    const { user } = await signUp();

    const response = await api()
      .get('/api/me')
      .set('Authorization', `Bearer ${expiredToken(user.id)}`);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.TOKEN_EXPIRED);
  });

  it('404s when the account behind a live token is gone', async () => {
    const { accessToken } = await signUp();
    await prisma.user.deleteMany();

    const response = await api().get('/api/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
  });

  it('cascades sessions away with the account', async () => {
    await signUp();
    expect(await prisma.refreshToken.count()).toBe(1);

    await prisma.user.deleteMany();

    expect(await prisma.refreshToken.count()).toBe(0);
  });
});

describe('PATCH /api/me', () => {
  it('renames the account', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .patch('/api/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Ada King' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Ada King');
  });

  it('rejects an empty name', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .patch('/api/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '   ' });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  // The whole point of taking the id from the token: there is no request body
  // that reaches somebody else's row.
  it('ignores a userId in the body and edits only the caller', async () => {
    const victim = await signUp({ email: 'victim@example.com' });
    const attacker = await signUp({ email: 'attacker@example.com' });

    await api()
      .patch('/api/me')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ name: 'Renamed', id: victim.user.id, userId: victim.user.id });

    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: victim.user.id } });
    expect(untouched.name).toBe('Ada Lovelace');
  });
});

describe('the server itself', () => {
  it('answers a health check without a token', async () => {
    const response = await api().get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns the error envelope for an unknown endpoint', async () => {
    const response = await api().get('/api/nope');

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe(ERROR_CODES.NOT_FOUND);
    expect(response.body.error).toHaveProperty('message');
    expect(response.body.error).toHaveProperty('details');
  });
});
