import express from 'express';
import type { Express } from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler, notFoundHandler } from './errors';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/auth/me.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { imagesRouter } from './modules/places/images.routes';
import { placesRouter } from './modules/places/places.routes';
import { referenceRouter } from './modules/places/reference.routes';
import { weatherRouter } from './modules/places/weather.routes';
import { plannerRouter } from './modules/planner/planner.routes';
import { ratesRouter } from './modules/rates/rates.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { travelRouter } from './modules/travel/travel.routes';
import { migrateRouter } from './modules/trips/migrate.routes';
import { activeTripRouter, tripsRouter } from './modules/trips/trips.routes';
import { serveSpa } from './static';

/**
 * The application, without a listening socket.
 *
 * Kept separate from `main.ts` so the test suite can mount it in-process with
 * Supertest — no port, no teardown, no chance of two suites fighting over 3000.
 */
export function createApp(): Express {
  const app = express();

  // Behind the Vite dev proxy, and behind whatever terminates TLS in
  // production. Without this the rate limiter buckets every request under the
  // proxy's own address and throttles all users as one.
  app.set('trust proxy', 1);

  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  // The reader's own trips. Authenticated, and scoped by the token's user in
  // every query — see the module docblock.
  app.use('/api', tripsRouter);
  app.use('/api', activeTripRouter);
  // Claims the trips a browser saved before there was anywhere else to put
  // them. Carries its own body limit — see the module.
  app.use('/api', migrateRouter);
  app.use('/api', settingsRouter);
  // A booking outlives the trip it was made for — see the module.
  app.use('/api', bookingsRouter);
  // Unauthenticated, and mounted at the root of /api because its paths are
  // domain-shaped (`/flights/search`) rather than grouped under one noun.
  app.use('/api', travelRouter);
  // Reference data too, and the least guarded thing here: see its docblock.
  app.use('/api', ratesRouter);
  // Facts about places in the world: attractions, the country and city lists,
  // and their photographs. The first of these holds the OpenTripMap key, which
  // is why the browser no longer needs one.
  app.use('/api', placesRouter);
  app.use('/api', referenceRouter);
  app.use('/api', imagesRouter);
  app.use('/api', weatherRouter);
  // Same root-level mounting, same reason. Unlike the routes above it, this one
  // authenticates and streams — see the module docblock.
  app.use('/api', plannerRouter);

  /*
   * The SPA, after the API and before the 404.
   *
   * After, so no static file can ever shadow an endpoint. Before, so that
   * `notFoundHandler` is left handling exactly what it should — an unknown
   * `/api` route — while an unknown page address goes to the app shell and is
   * routed by the client. A no-op when there is no build, which is every run
   * in development and every run under test.
   */
  serveSpa(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
