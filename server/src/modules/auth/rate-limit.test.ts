import { ERROR_CODES } from '@ai-travel/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, credentials, errorCode, signUp, VALID_PASSWORD } from '../../test/harness';
import { resetRateLimits } from './rate-limit';

/**
 * The credential throttles.
 *
 * Every other suite runs with these off — they fail login deliberately and
 * would throttle themselves — so this file turns them back on for itself.
 *
 * The limiter keeps its counters in module state for the life of the process,
 * which is why `fileParallelism` is off and why these tests use a distinct
 * email each time.
 *
 * Every test here is slow on purpose: each attempt runs a real argon2
 * verification, and there are a dozen or more per test. The suite's raised
 * `testTimeout` is what keeps that from being mistaken for a hang.
 */

beforeEach(() => {
  process.env.DISABLE_RATE_LIMIT = '0';
  resetRateLimits();
});

afterEach(() => {
  process.env.DISABLE_RATE_LIMIT = '1';
  resetRateLimits();
});

/** One failed sign-in attempt. */
function failLogin(email: string) {
  return api().post('/api/auth/login').send({ email, password: 'wrong-password-entirely' });
}

describe('login throttling', () => {
  it('stops a run of failed attempts', async () => {
    await signUp({ email: 'target@example.com' });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await failLogin('target@example.com')).status);
    }

    expect(statuses.filter((status) => status === 401).length).toBeGreaterThan(0);
    expect(statuses.at(-1)).toBe(429);
  });

  it('answers a throttled request in the standard error envelope', async () => {
    await signUp({ email: 'envelope@example.com' });

    let response = await failLogin('envelope@example.com');
    for (let attempt = 0; attempt < 12 && response.status !== 429; attempt += 1) {
      response = await failLogin('envelope@example.com');
    }

    expect(response.status).toBe(429);
    expect(errorCode(response)).toBe(ERROR_CODES.RATE_LIMITED);
    expect(response.body.error.message).toContain('Too many attempts');
  });

  // A correct password should not spend budget, or one forgetful person would
  // lock out everyone sharing their address.
  it('does not count successful sign-ins', async () => {
    await signUp({ email: 'busy@example.com' });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await api()
        .post('/api/auth/login')
        .send({ email: 'busy@example.com', password: VALID_PASSWORD });

      expect(response.status).toBe(200);
    }
  });
});

describe('registration throttling', () => {
  it('caps how many accounts one address can open', async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await api()
        .post('/api/auth/register')
        .send(credentials({ email: `flood-${attempt}@example.com` }));

      statuses.push(response.status);
    }

    expect(statuses.at(0)).toBe(201);
    expect(statuses.at(-1)).toBe(429);
  });
});
