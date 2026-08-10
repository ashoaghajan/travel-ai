import {
  chatHistorySchema,
  saveActivityBodySchema,
  saveSearchBodySchema,
} from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import {
  clearChatHistory,
  clearSavedActivities,
  clearSearches,
  getChatHistory,
  listFlightSearches,
  listSavedActivities,
  removeSavedActivity,
  saveActivity,
  saveChatHistory,
  saveFlightSearch,
} from './library.service';

/**
 * Saved attractions, recent searches and the planner conversation.
 *
 * `requireAuth` per route, not `router.use()`: mounted at `/api` alongside the
 * unauthenticated reference endpoints, where a router-level guard would 401
 * all of them.
 *
 * Each write answers with the whole list rather than the one row it touched.
 * These are short — five searches, a couple of hundred bookmarks — and it lets
 * the client replace what it holds rather than merge towards it, which is how
 * a screen ends up showing something the database does not have.
 */

export const libraryRouter = Router();

function param(request: Request, name: string): string {
  const raw = request.params[name];

  return typeof raw === 'string' ? raw : '';
}

/* --------------------------------------------------------- saved activities */

libraryRouter.get(
  '/saved-activities',
  requireAuth,
  async (request: Request, response: Response) => {
    response.json(await listSavedActivities(userIdOf(request)));
  },
);

libraryRouter.put(
  '/saved-activities/:activityId',
  requireAuth,
  async (request: Request, response: Response) => {
    const body = saveActivityBodySchema.parse(request.body);

    response.json(await saveActivity(userIdOf(request), param(request, 'activityId'), body));
  },
);

libraryRouter.delete(
  '/saved-activities/:activityId',
  requireAuth,
  async (request: Request, response: Response) => {
    response.json(await removeSavedActivity(userIdOf(request), param(request, 'activityId')));
  },
);

libraryRouter.delete(
  '/saved-activities',
  requireAuth,
  async (request: Request, response: Response) => {
    await clearSavedActivities(userIdOf(request));

    response.status(204).end();
  },
);

/* ---------------------------------------------------------- recent searches */

libraryRouter.get(
  '/searches/flights',
  requireAuth,
  async (request: Request, response: Response) => {
    response.json(await listFlightSearches(userIdOf(request)));
  },
);

libraryRouter.post(
  '/searches/flights',
  requireAuth,
  async (request: Request, response: Response) => {
    const body = saveSearchBodySchema.parse(request.body);

    response.json(await saveFlightSearch(userIdOf(request), body));
  },
);

libraryRouter.delete('/searches', requireAuth, async (request: Request, response: Response) => {
  await clearSearches(userIdOf(request));

  response.status(204).end();
});

/* ------------------------------------------------------------- chat history */

libraryRouter.get(
  '/conversations/current',
  requireAuth,
  async (request: Request, response: Response) => {
    response.json({ messages: await getChatHistory(userIdOf(request)) });
  },
);

libraryRouter.put(
  '/conversations/current',
  requireAuth,
  async (request: Request, response: Response) => {
    const { messages } = chatHistorySchema.parse(request.body);

    await saveChatHistory(userIdOf(request), messages);

    response.status(204).end();
  },
);

libraryRouter.delete(
  '/conversations/current',
  requireAuth,
  async (request: Request, response: Response) => {
    await clearChatHistory(userIdOf(request));

    response.status(204).end();
  },
);
