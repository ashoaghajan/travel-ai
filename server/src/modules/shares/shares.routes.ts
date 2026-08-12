import { createTripSchema, shareTripSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import { sendRateLimit } from '../messages/messages.routes';
import { publishToBoth } from '../messages/realtime';
import { acceptShare, getShare, messageForShare, revokeShare, shareTrip } from './shares.service';

/**
 * Trips, offered through a conversation.
 *
 * Two prefixes on one router, and deliberately: **sharing** is something you do
 * to a trip, so it hangs off `/trips/:id`, while **an offer** is a thing of its
 * own with its own lifetime — it outlives the trip it came from — so it gets
 * `/shares/:id`. Putting both under `/trips` would make a share look like part
 * of a trip, which is the one thing it stops being the moment it is sent.
 *
 * `requireAuth` per route, as everywhere else here.
 */
export const sharesRouter = Router();

/** The path parameter, as a string this file is willing to pass on. */
function idOf(request: Request, name: string): string {
  const value = request.params[name];

  return typeof value === 'string' ? value : '';
}

/**
 * Offers one of your trips to somebody.
 *
 * The message it creates is published to both inboxes like any other, so the
 * card appears in both threads without either end refetching. A publish that
 * fails still leaves the offer written down — see `publishToBoth`.
 */
sharesRouter.post(
  '/trips/:id/share',
  requireAuth,
  /*
   * The same budget a written message spends, and after the guard so it is
   * keyed on the account rather than the address.
   *
   * Sharing was unthrottled while sending "hello" was not, which is backwards:
   * a share writes a snapshot of a whole itinerary, so it is the heavier of the
   * two by some margin. One budget per person rather than two, because what is
   * being limited is a person doing things to another account.
   */
  sendRateLimit,
  async (request: Request, response: Response) => {
    const { toUserId, trip } = shareTripSchema.parse(request.body);
    const clientMessageId = clientMessageIdOf(request);

    const message = await shareTrip(
      userIdOf(request),
      idOf(request, 'id'),
      toUserId,
      trip,
      clientMessageId,
    );

    await publishToBoth([message.senderId, message.recipientId], {
      name: 'message',
      data: message,
    });

    response.status(201).json(message);
  },
);

/**
 * The browser's own id for this share, so a retry cannot offer twice.
 *
 * Optional in the body rather than required as it is for a written message:
 * this call is a button on a dialog rather than a composer, and a client that
 * omitted it would get one offer per press — which the sender can withdraw.
 * Falling back to a value derived from the request keeps the column non-null.
 */
function clientMessageIdOf(request: Request): string {
  const value = (request.body as { clientMessageId?: unknown }).clientMessageId;

  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : `share_${Date.now()}`;
}

sharesRouter.get('/shares/:id', requireAuth, async (request: Request, response: Response) => {
  response.json(await getShare(userIdOf(request), idOf(request, 'id')));
});

/**
 * Takes up an offer.
 *
 * The body is a trip, because the recipient's own client is what turns the
 * snapshot back into one — resolving each photograph against its own build.
 * It is validated exactly as a hand-made trip is.
 */
sharesRouter.post(
  '/shares/:id/accept',
  requireAuth,
  async (request: Request, response: Response) => {
    const trip = createTripSchema.parse(request.body);
    const shareId = idOf(request, 'id');

    const created = await acceptShare(userIdOf(request), shareId, trip);

    await announce(shareId);

    response.status(201).json(created);
  },
);

sharesRouter.delete('/shares/:id', requireAuth, async (request: Request, response: Response) => {
  const shareId = idOf(request, 'id');

  await revokeShare(userIdOf(request), shareId);
  await announce(shareId);

  response.status(204).end();
});

/**
 * Tells both ends that a card has changed.
 *
 * The whole message goes rather than a patch: it is small, it is the shape both
 * clients already know how to reconcile by id, and a second event shape would
 * be a second thing that can disagree with the first.
 */
async function announce(shareId: string): Promise<void> {
  const message = await messageForShare(shareId);
  if (!message) return;

  await publishToBoth([message.senderId, message.recipientId], {
    name: 'share',
    data: message,
  });
}
