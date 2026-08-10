import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRates } from './exchange';

/**
 * `GET /api/rates` — what a US dollar buys, per offered currency.
 *
 * Unauthenticated and unthrottled, unlike the priced searches next door. Both
 * differences follow from the same fact: this endpoint costs nothing to serve.
 * It answers from process memory, the provider behind it is free and keyless,
 * and a caller hammering it burns no quota that we own. There is nothing here
 * for a limiter to protect.
 *
 * Every reader gets the same table, so the response is cacheable by anything
 * in between.
 */

export const ratesRouter = Router();

/** Matches the table's own six-hour hold — see `exchange.ts`. */
const MAX_AGE_SECONDS = 6 * 60 * 60;

ratesRouter.get('/rates', async (_request: Request, response: Response) => {
  const rates = await getRates();

  // Stale rates are the fallback path, and telling a CDN to hold them for six
  // hours would outlive the outage that produced them.
  response.set('Cache-Control', rates.isStale ? 'no-store' : `public, max-age=${MAX_AGE_SECONDS}`);

  response.json(rates);
});
