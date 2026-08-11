import { ERROR_CODES } from '@ai-travel/shared';
import { lobbyPeopleQuerySchema, sendLobbyMessageSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import { HttpError } from '../../errors';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import { createTokenRequest, isConfigured, publishMessage } from './ably';
import { createMessage, deleteMessage, listPeople, listRecentMessages } from './lobby.service';

/**
 * `/api/lobby` — the public room.
 *
 * `requireAuth` per route rather than `router.use`, like every other router
 * here: this is mounted on `/api` alongside the unauthenticated reference
 * endpoints, and a router-level guard would 401 all of them.
 */
export const lobbyRouter = Router();

const store = new MemoryStore();

/** Held so the suite can clear the counter between tests — see `rate-limit.ts`. */
export function resetLobbyRateLimit(): void {
  store.resetAll?.();
}

/**
 * Sends, throttled by account rather than by address.
 *
 * Note this runs **after** `requireAuth`, which is the opposite order from
 * `planner.routes.ts`, where rejecting a flood before doing any work is the
 * cheapest thing that endpoint can do. Here the bucket is the account, and
 * `request.userId` does not exist until the guard has run. That is the right
 * bucket: every send already requires a valid session, so an address bucket
 * would throttle a shared office and stop no one who has an account.
 *
 * Sized to a person talking, not to what the database will take.
 */
const sendRateLimit = rateLimit({
  store,
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  keyGenerator: (request: Request) =>
    request.userId ? `lobby:${request.userId}` : ipKeyGenerator(request.ip ?? ''),
  handler: (_request: Request, response: Response) => {
    response.status(429).json({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'That is a lot of messages. Give it a moment.',
        details: null,
      },
    });
  },
});

lobbyRouter.get('/lobby/messages', requireAuth, async (_request: Request, response: Response) => {
  response.json(await listRecentMessages());
});

lobbyRouter.post(
  '/lobby/messages',
  requireAuth,
  sendRateLimit,
  async (request: Request, response: Response) => {
    const { body, clientMessageId } = sendLobbyMessageSchema.parse(request.body);
    const message = await createMessage(userIdOf(request), body, clientMessageId);

    // Written first, then fanned out. Awaited so a test can observe it, but it
    // cannot fail the request — see `publishMessage`.
    await publishMessage({ name: 'message', data: message });

    response.status(201).json(message);
  },
);

lobbyRouter.delete(
  '/lobby/messages/:messageId',
  requireAuth,
  async (request: Request, response: Response) => {
    const messageId = request.params.messageId;

    const id = typeof messageId === 'string' ? messageId : '';

    await deleteMessage(userIdOf(request), id);
    await publishMessage({ name: 'delete', data: { id } });

    response.status(204).end();
  },
);

/**
 * A short-lived token letting this browser listen to the room.
 *
 * The API key never leaves the server; what goes back is signed, expires in an
 * hour, is pinned to the caller's user id, and cannot publish. See `ably.ts`.
 */
lobbyRouter.get('/lobby/token', requireAuth, async (request: Request, response: Response) => {
  if (!isConfigured()) {
    throw new HttpError(
      503,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      'Live messages are not switched on.',
    );
  }

  response.json(await createTokenRequest(userIdOf(request)));
});

/**
 * Who is in the room: everyone who has posted, plus whoever the caller can
 * see in the presence set.
 *
 * The ids come from the client because presence is Ably's and this server
 * never joins it. Without them a person who connects and says nothing would
 * be invisible until they spoke, which is not what "who is here" means.
 */
lobbyRouter.get('/lobby/people', requireAuth, async (request: Request, response: Response) => {
  const { online } = lobbyPeopleQuerySchema.parse(request.query);

  response.json(await listPeople(online));
});
