import { ERROR_CODES } from '@ai-travel/shared';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import { toEmailKey } from '@ai-travel/shared/schemas';

/**
 * Throttling for the credential endpoints.
 *
 * STAGE_2_PLAN rate-limits only the public explore routes, which leaves login
 * open to unlimited guessing — the one place on this server where guessing
 * actually pays. Two limiters, because the two attacks look different: one
 * address trying many accounts, and many addresses trying one account.
 *
 * Failures only. A correct password does not consume budget, so a busy
 * household behind one address never locks itself out.
 */

function reject(_request: Request, response: Response): void {
  response.status(429).json({
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many attempts. Wait a few minutes and try again.',
      details: null,
    },
  });
}

/**
 * Read live rather than through `env()`, which caches at first call. The test
 * that proves the limiter works has to be able to switch it back on after the
 * setup file switched it off.
 */
const enabled = () => process.env.DISABLE_RATE_LIMIT !== '1';

/**
 * Held so the suite can clear them between tests.
 *
 * Counters otherwise live for the process, and a test that exhausts a budget
 * would decide the outcome of every test after it.
 */
const stores = [new MemoryStore(), new MemoryStore(), new MemoryStore()] as const;

export function resetRateLimits(): void {
  stores.forEach((store) => store.resetAll?.());
}

export const loginRateLimit = rateLimit({
  store: stores[0],
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !enabled(),
  handler: reject,
});

/**
 * The same budget again, per account.
 *
 * Spreading an attack across a botnet defeats the address limiter but not this
 * one, because every attempt still names the account it is after.
 */
export const accountRateLimit = rateLimit({
  store: stores[1],
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  skip: () => !enabled(),
  // `ipKeyGenerator` normalises IPv6 into a /64 subnet; falling back to it
  // keeps a body-less request from sharing one bucket with every other.
  keyGenerator: (request) => {
    const email: unknown = (request.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? `account:${toEmailKey(email)}` : ipKeyGenerator(request.ip ?? '');
  },
  handler: reject,
});

/** Registration is cheaper to abuse than to defend; a looser cap is enough. */
export const registerRateLimit = rateLimit({
  store: stores[2],
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !enabled(),
  handler: reject,
});
