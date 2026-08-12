import { peopleSearchSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import { publishToBoth } from '../messages/realtime';
import {
  acceptRequest,
  friendStats,
  listFriends,
  listRequests,
  removeFriend,
  requestFriend,
  searchPeople,
} from './friends.service';

/**
 * `/api/friends` — who may talk to whom.
 *
 * Seven routes and no request bodies: a friendship has no fields. It exists or
 * it does not, and every route names its subject in the path.
 *
 * `requireAuth` per route, as everywhere else here.
 */
export const friendsRouter = Router();

/** The path parameter, as a string this file is willing to pass on. */
function otherIdOf(request: Request): string {
  const value = request.params.userId;

  return typeof value === 'string' ? value : '';
}

friendsRouter.get('/friends', requireAuth, async (request: Request, response: Response) => {
  response.json(await listFriends(userIdOf(request)));
});

/*
 * Before `/friends/:userId` would ever be reached — Express matches in order,
 * and `requests`, `stats` and `search` are not user ids. There is no
 * `GET /friends/:userId`, so nothing collides today; the order is kept anyway
 * because the day somebody adds one is the day this would break silently.
 */
friendsRouter.get('/friends/requests', requireAuth, async (request: Request, response: Response) => {
  response.json(await listRequests(userIdOf(request)));
});

friendsRouter.get('/friends/stats', requireAuth, async (request: Request, response: Response) => {
  response.json(await friendStats(userIdOf(request)));
});

/**
 * Everybody, with where the caller stands with each of them.
 *
 * The one place accounts remain enumerable, which is what makes finding a
 * friend possible at all. Names only; a test asserts no address is in the body.
 */
friendsRouter.get('/friends/search', requireAuth, async (request: Request, response: Response) => {
  const query = peopleSearchSchema.parse(request.query);

  response.json(await searchPeople(userIdOf(request), query));
});

/** Asks — or accepts, when they asked first. See `requestFriend`. */
friendsRouter.post(
  '/friends/:userId',
  requireAuth,
  async (request: Request, response: Response) => {
    const status = await requestFriend(userIdOf(request), otherIdOf(request));

    await announce(userIdOf(request), otherIdOf(request));

    response.status(201).json({ status });
  },
);

/**
 * Tells both ends that something about them changed.
 *
 * On the inbox channel each of them already has, because there is one socket
 * per tab and a second connection for this would be a second thing to keep
 * alive for one event a day. It carries nothing: the client refetches, which
 * is the same rule the rest of this store follows — the other end may have
 * changed it again in the meantime.
 */
async function announce(a: string, b: string): Promise<void> {
  await publishToBoth([a, b], { name: 'friend', data: {} });
}

friendsRouter.post(
  '/friends/:userId/accept',
  requireAuth,
  async (request: Request, response: Response) => {
    const status = await acceptRequest(userIdOf(request), otherIdOf(request));

    await announce(userIdOf(request), otherIdOf(request));

    response.json({ status });
  },
);

/**
 * Cancel, decline, unfriend.
 *
 * One route, because they are one fact: the connection stops existing. Which
 * of the three words applies is something the row knows and the caller should
 * not have to.
 */
friendsRouter.delete(
  '/friends/:userId',
  requireAuth,
  async (request: Request, response: Response) => {
    await removeFriend(userIdOf(request), otherIdOf(request));

    await announce(userIdOf(request), otherIdOf(request));

    response.status(204).end();
  },
);
