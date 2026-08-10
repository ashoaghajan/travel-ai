import { createBookingSchema, updateBookingSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import {
  createBooking,
  createBookings,
  deleteBooking,
  listBookings,
  updateBooking,
} from './bookings.service';

/**
 * `/api/bookings` — the flights, stays, tickets and activities of whoever is
 * asking.
 *
 * `requireAuth` per route, not `router.use()`: this router is mounted at
 * `/api` alongside the unauthenticated reference endpoints, and a
 * router-level guard there would 401 all of them.
 */

export const bookingsRouter = Router();

function param(request: Request, name: string): string {
  const raw = request.params[name];

  return typeof raw === 'string' ? raw : '';
}

/**
 * One booking, or several.
 *
 * A round-trip fare is two bookings and filing a trip's schedule is a dozen,
 * so the endpoint takes either — a batch goes in one transaction rather than
 * as a dozen requests that can half-fail.
 */
const createBody = z.union([
  createBookingSchema,
  z.object({ bookings: z.array(createBookingSchema).min(1).max(100) }),
]);

bookingsRouter.get('/bookings', requireAuth, async (request: Request, response: Response) => {
  response.json(await listBookings(userIdOf(request)));
});

bookingsRouter.post('/bookings', requireAuth, async (request: Request, response: Response) => {
  const body = createBody.parse(request.body);
  const userId = userIdOf(request);

  if ('bookings' in body) {
    return void response.status(201).json(await createBookings(userId, body.bookings));
  }

  response.status(201).json(await createBooking(userId, body));
});

bookingsRouter.patch(
  '/bookings/:id',
  requireAuth,
  async (request: Request, response: Response) => {
    const patch = updateBookingSchema.parse(request.body ?? {});

    response.json(await updateBooking(userIdOf(request), param(request, 'id'), patch));
  },
);

bookingsRouter.delete(
  '/bookings/:id',
  requireAuth,
  async (request: Request, response: Response) => {
    await deleteBooking(userIdOf(request), param(request, 'id'));

    response.status(204).end();
  },
);
