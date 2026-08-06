import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { HttpError } from '../../errors';
import { resetEnvCache } from '../../env';
import { isConfigured, toHttpError } from './anthropic';

/**
 * Turning the SDK's failures into this API's own.
 *
 * Nothing above this module should have to know what an `APIConnectionError`
 * is, and every message here is read by the person waiting in the chat — so
 * "the planner is misconfigured on this server" must not reach them as "429",
 * and a bad key must not read as their fault.
 */

const headers = new Headers();

beforeEach(() => {
  resetEnvCache();
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  resetEnvCache();
});

describe('isConfigured', () => {
  it('is false without a key, which is what the route checks', () => {
    delete process.env.ANTHROPIC_API_KEY;
    resetEnvCache();

    expect(isConfigured()).toBe(false);
  });

  it('is true with one', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    resetEnvCache();

    expect(isConfigured()).toBe(true);
  });
});

describe('toHttpError', () => {
  it('passes our own errors through untouched', () => {
    const original = new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'No.');

    expect(toHttpError(original)).toBe(original);
  });

  it('reads a rate limit as one, so the client can say "try again"', () => {
    const error = toHttpError(new Anthropic.RateLimitError(429, undefined, 'busy', headers));

    expect(error.status).toBe(429);
    expect(error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('does not blame the reader for a key this server got wrong', () => {
    const error = toHttpError(new Anthropic.AuthenticationError(401, undefined, 'bad key', headers));

    // Deliberately not 401: the reader is signed in, the *server* is at fault.
    expect(error.status).toBe(502);
    expect(error.message).toContain('misconfigured');
  });

  it('reads an unreachable provider as a bad gateway', () => {
    const error = toHttpError(new Anthropic.APIConnectionError({ message: 'ECONNRESET' }));

    expect(error.status).toBe(502);
    expect(error.message).toContain('could not reach');
  });

  it('has a message for any other API failure', () => {
    const error = toHttpError(new Anthropic.APIError(500, undefined, 'boom', headers));

    expect(error.status).toBe(502);
    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('never lets something unrecognised escape as a raw throw', () => {
    const error = toHttpError(new TypeError('undefined is not a function'));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(500);
    // Nothing about the internals reaches the chat.
    expect(error.message).not.toContain('undefined');
  });
});
