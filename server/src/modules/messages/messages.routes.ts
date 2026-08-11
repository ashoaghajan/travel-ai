import { ERROR_CODES } from '@ai-travel/shared';
import { conversationsQuerySchema, sendDirectMessageSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import {
  createMessage,
  deleteMessage,
  listConversations,
  listThread,
  markRead,
} from './messages.service';

/**
 * `/api/messages` — private conversations, two people at a time.
 *
 * `requireAuth` per route rather than `router.use`, like every other router
 * here: this is mounted on `/api` alongside the unauthenticated reference
 * endpoints, and a router-level guard would 401 all of them.
 */
export const messagesRouter = Router();

const store = new MemoryStore();

/** Held so the suite can clear the counter between tests — see `rate-limit.ts`. */
export function resetMessagesRateLimit(): void {
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
 * Sized to a person talking, not to what the database will take. Counted
 * across all of a reader's conversations rather than per thread, because the
 * thing being limited is a person, not a relationship.
 */
const sendRateLimit = rateLimit({
  store,
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  keyGenerator: (request: Request) =>
    request.userId ? `messages:${request.userId}` : ipKeyGenerator(request.ip ?? ''),
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

/** The path parameter, as a string this file is willing to pass on. */
function otherIdOf(request: Request): string {
  const value = request.params.userId;

  return typeof value === 'string' ? value : '';
}

/**
 * Everyone you could talk to.
 *
 * Every account, not only the people you have written to — you cannot message
 * somebody you cannot find. Names only; no email is ever selected, and a test
 * asserts the serialised body contains no address at all.
 */
messagesRouter.get(
  '/messages/conversations',
  requireAuth,
  async (request: Request, response: Response) => {
    const query = conversationsQuerySchema.parse(request.query);

    response.json(await listConversations(userIdOf(request), query));
  },
);

messagesRouter.get(
  '/messages/with/:userId',
  requireAuth,
  async (request: Request, response: Response) => {
    response.json(await listThread(userIdOf(request), otherIdOf(request)));
  },
);

messagesRouter.post(
  '/messages/with/:userId',
  requireAuth,
  sendRateLimit,
  async (request: Request, response: Response) => {
    const { body, clientMessageId } = sendDirectMessageSchema.parse(request.body);

    const message = await createMessage(
      userIdOf(request),
      otherIdOf(request),
      body,
      clientMessageId,
    );

    response.status(201).json(message);
  },
);

/** Marks this conversation read up to now. Idempotent; nothing to return. */
messagesRouter.post(
  '/messages/with/:userId/read',
  requireAuth,
  async (request: Request, response: Response) => {
    await markRead(userIdOf(request), otherIdOf(request));

    response.status(204).end();
  },
);

messagesRouter.delete(
  '/messages/:messageId',
  requireAuth,
  async (request: Request, response: Response) => {
    const messageId = request.params.messageId;

    await deleteMessage(userIdOf(request), typeof messageId === 'string' ? messageId : '');

    response.status(204).end();
  },
);
