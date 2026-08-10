import { updateSettingsSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import { getSettings, updateSettings } from './settings.service';

/**
 * `/api/settings` — app preferences.
 *
 * There is a `GET` here for completeness, but the SPA does not use it at boot:
 * `GET /api/me` already carries the settings so that starting the app is one
 * request rather than three. This exists for a refresh after a change made
 * elsewhere, and so the resource has a URL of its own.
 *
 * `requireAuth` per route, not `router.use()` — this router is mounted at
 * `/api` alongside the unauthenticated reference endpoints.
 */

export const settingsRouter = Router();

settingsRouter.get('/settings', requireAuth, async (request: Request, response: Response) => {
  response.json(await getSettings(userIdOf(request)));
});

settingsRouter.put('/settings', requireAuth, async (request: Request, response: Response) => {
  const patch = updateSettingsSchema.parse(request.body ?? {});

  response.json(await updateSettings(userIdOf(request), patch));
});
