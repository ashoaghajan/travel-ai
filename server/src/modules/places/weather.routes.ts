import { ERROR_CODES } from '@ai-travel/shared';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../errors';
import { PlaceNotFoundError, findPlace, getWeather } from '../planner/weather';

/**
 * `/api/weather` — Open-Meteo, proxied.
 *
 * Reuses the planner's weather client rather than standing up a second one.
 * The SPA needs the same two answers the model's `get_weather` tool needs, and
 * two implementations of "what is the weather in X" would drift.
 *
 * Keyless, so this did not move for secrecy. It moved so the browser makes no
 * third-party request of its own, and so the one in-process cache in that
 * client serves the SPA as well as the model.
 */

export const weatherRouter = Router();

const query = z.object({
  place: z.string().trim().min(1, 'Name a place.').max(120),
  /** Today plus up to six days; the client's fallback planner asks for one. */
  days: z.coerce.number().int().min(1).max(7).default(1),
});

/**
 * A name that resolves to nothing is a 404, not a 502.
 *
 * The planner repeats this back to the reader ("I could not find anywhere
 * called X"), which is a different sentence from "the lookup failed" — so the
 * two must stay distinguishable across the wire.
 */
function asHttpError(error: unknown): HttpError {
  if (error instanceof PlaceNotFoundError) {
    return new HttpError(404, ERROR_CODES.NOT_FOUND, error.message);
  }

  return new HttpError(502, ERROR_CODES.INTERNAL, 'Weather is unavailable right now.');
}

weatherRouter.get('/weather', async (request: Request, response: Response) => {
  const { place, days } = query.parse(request.query);

  try {
    response.json(await getWeather(place, days));
  } catch (error) {
    throw asHttpError(error);
  }
});

weatherRouter.get('/weather/place', async (request: Request, response: Response) => {
  const { place } = query.parse(request.query);

  try {
    response.json(await findPlace(place));
  } catch (error) {
    throw asHttpError(error);
  }
});
