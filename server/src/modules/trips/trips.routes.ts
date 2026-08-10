import {
  activeTripSchema,
  addActivitySchema,
  createTripSchema,
  updateTripSchema,
} from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import {
  addActivityToDay,
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  setActiveTrip,
  updateTrip,
} from './trips.service';

/**
 * `/api/trips` — the saved trips of whoever is asking.
 *
 * Every handler takes the owner from the verified token via `userIdOf` and
 * never from the body or the path, so there is no shape of request that
 * reaches another account's trip.
 */

export const tripsRouter = Router();

/*
 * `requireAuth` is attached per route, not with `tripsRouter.use()`.
 *
 * This router is mounted at `/api` so its paths can be domain-shaped, and a
 * router-level `use()` there runs for *every* request that reaches `/api` —
 * including the unauthenticated reference endpoints mounted after it. That
 * turns `/api/reference/countries` into a 401 and is invisible until
 * something asks for it signed out.
 */

/** Path segments are typed as possibly-array; a named segment never is. */
function param(request: Request, name: string): string {
  const raw = request.params[name];

  return typeof raw === 'string' ? raw : '';
}

tripsRouter.get('/trips', requireAuth, async (request: Request, response: Response) => {
  response.json(await listTrips(userIdOf(request)));
});

tripsRouter.get('/trips/:id', requireAuth, async (request: Request, response: Response) => {
  response.json(await getTrip(userIdOf(request), param(request, 'id')));
});

tripsRouter.post('/trips', requireAuth, async (request: Request, response: Response) => {
  const body = createTripSchema.parse(request.body);
  const { trip, created } = await createTrip(userIdOf(request), body);

  /*
   * `200` when the draft was already saved, `201` when this call made it.
   *
   * The distinction is the client's only way to tell a real save from an
   * idempotent replay, and the planner uses it to avoid announcing "saved!"
   * twice for one trip.
   */
  response.status(created ? 201 : 200).json(trip);
});

tripsRouter.patch('/trips/:id', requireAuth, async (request: Request, response: Response) => {
  const patch = updateTripSchema.parse(request.body ?? {});

  response.json(await updateTrip(userIdOf(request), param(request, 'id'), patch));
});

tripsRouter.delete('/trips/:id', requireAuth, async (request: Request, response: Response) => {
  await deleteTrip(userIdOf(request), param(request, 'id'));

  response.status(204).end();
});

tripsRouter.post(
  '/trips/:id/days/:dayId/activities',
  requireAuth,
  async (request: Request, response: Response) => {
    const body = addActivitySchema.parse(request.body);

    response.json(
      await addActivityToDay(
        userIdOf(request),
        param(request, 'id'),
        param(request, 'dayId'),
        body,
      ),
    );
  },
);

/**
 * The trip last opened.
 *
 * Under `/api/me` rather than `/api/trips` because it is a fact about the
 * person, not about any one trip — and because there is exactly one of them.
 */
export const activeTripRouter = Router();

activeTripRouter.put(
  '/me/active-trip',
  requireAuth,
  async (request: Request, response: Response) => {
    const { tripId } = activeTripSchema.parse(request.body);

    await setActiveTrip(userIdOf(request), tripId);

    response.status(204).end();
  },
);
