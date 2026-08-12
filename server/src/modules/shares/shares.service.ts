import { ERROR_CODES } from '@ai-travel/shared';
import type { ApiDirectMessage, ApiSharedTrip, ApiTripShare } from '@ai-travel/shared';
import type { CreateTripBody, SharedTripBody } from '@ai-travel/shared/schemas';
import { Prisma } from '@prisma/client';
import { HttpError, notFound } from '../../errors';
import { prisma } from '../../prisma';
import { createMessage, toApiMessage } from '../messages/messages.service';
import { createTrip } from '../trips/trips.service';
import type { ApiTrip } from '../trips/trips.service';

/**
 * Offering a trip to somebody, and taking one up.
 *
 * The offer is a snapshot — an `ExportedTrip`, the same document `Export`
 * writes to a file — and that is what makes this small: the format, its
 * validation and the code that turns it back into a trip all existed before
 * this feature did. Nothing here invents a second way for a trip to travel.
 *
 * Two rules run through everything below:
 *
 * - **Offer, never convert.** Nothing is written into the recipient's account
 *   until they accept. The same principle that keeps an itinerary activity a
 *   guess and a booking a fact.
 * - **A share is a message.** It lands in the thread, on the channel that
 *   already exists, and the message carries a body a screen reader can read.
 */

/** What the card needs, without the itinerary behind it. */
type ShareRow = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

export function toApiShare(row: ShareRow): ApiTripShare {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    startDate: row.startDate,
    endDate: row.endDate,
    dayCount: row.dayCount,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * The line that stands in for the trip everywhere a card cannot go.
 *
 * The conversation list preview, a notification, a screen reader reading the
 * thread. A message whose body is empty is a message half the app renders as
 * nothing at all.
 */
function bodyFor(trip: SharedTripBody): string {
  return `Shared a trip: ${trip.title}`;
}

/**
 * Offers a trip.
 *
 * One transaction, because half of this pair existing is the one state the
 * feature must never reach: an offer nobody was told about, or a message
 * pointing at nothing.
 *
 * The trip id is checked against the sender rather than used to build the
 * snapshot — the browser builds that, because a bundled photograph's stable
 * name lives in the client bundle (see `share.schemas.ts`). What this proves is
 * that the sender has a trip by that id, which is what stops a share citing
 * somebody else's.
 */
export async function shareTrip(
  fromUserId: string,
  tripId: string,
  toUserId: string,
  trip: SharedTripBody,
  clientMessageId: string,
): Promise<ApiDirectMessage> {
  const owned = await prisma.trip.findFirst({
    where: { id: tripId, userId: fromUserId },
    select: { id: true },
  });
  if (!owned) throw notFound('That trip is no longer here.');

  // Reuses every rule a written message already obeys: the recipient exists,
  // it is not you, and the pair key is derived from the two ids.
  const message = await createMessage(fromUserId, toUserId, bodyFor(trip), clientMessageId, {
    share: {
      tripId,
      toUserId,
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      dayCount: trip.itinerary.length,
      snapshot: trip as unknown as Prisma.InputJsonValue,
    },
  });

  return message;
}

/**
 * The offer, with the trip inside it.
 *
 * Either participant may read it, and nobody else — a uuid is unguessable but
 * "unguessable" is not an authorisation model. A withdrawn offer still reads,
 * so the card can say what happened rather than turning into a 404 on somebody
 * else's screen.
 */
export async function getShare(userId: string, shareId: string): Promise<ApiSharedTrip> {
  const row = await prisma.tripShare.findUnique({ where: { id: shareId } });

  if (!row || (row.fromUserId !== userId && row.toUserId !== userId)) {
    throw new HttpError(404, ERROR_CODES.SHARE_NOT_FOUND, 'That trip is no longer shared.');
  }

  return { share: toApiShare(row), trip: row.snapshot };
}

/**
 * Takes up an offer, as a copy.
 *
 * The trip in the body is the recipient's own client turning the snapshot back
 * into a trip — resolving each photograph against *its* build, which is the one
 * step no server can do. It is then validated exactly as a hand-made trip is,
 * because by the time it comes back it is input like any other.
 *
 * **Idempotent through `draftId`.** Set here rather than taken from the client
 * and derived from the share, so a second accept — a double tap, a cold
 * instance, a retry — resolves to the trip the first one made instead of a
 * second copy. That is the same mechanism `clientMessageId` gives a send.
 */
export async function acceptShare(
  userId: string,
  shareId: string,
  trip: CreateTripBody,
): Promise<ApiTrip> {
  const row = await prisma.tripShare.findUnique({ where: { id: shareId } });

  if (!row || row.toUserId !== userId) {
    throw new HttpError(404, ERROR_CODES.SHARE_NOT_FOUND, 'That trip is no longer shared.');
  }

  if (row.revokedAt) {
    throw new HttpError(
      410,
      ERROR_CODES.SHARE_REVOKED,
      'That trip is no longer being shared with you.',
    );
  }

  const { trip: created } = await createTrip(userId, { ...trip, draftId: `share:${shareId}` });

  /*
   * Marked after the copy exists, and only the first time.
   *
   * `acceptedAt: null` in the filter is what makes a second accept leave the
   * original timestamp alone — the trip is already theirs and the moment they
   * took it up was the first one, not the retry.
   */
  await prisma.tripShare.updateMany({
    where: { id: shareId, acceptedAt: null },
    data: { acceptedAt: new Date(), acceptedTripId: created.id },
  });

  return created;
}

/**
 * Withdraws an offer.
 *
 * Only the sender, and only while it is still an offer: once somebody has taken
 * it up the copy is theirs, and reaching into another account to delete a trip
 * is not what "revoke" means anywhere.
 */
export async function revokeShare(userId: string, shareId: string): Promise<ApiTripShare> {
  const row = await prisma.tripShare.findUnique({ where: { id: shareId } });

  if (!row) throw new HttpError(404, ERROR_CODES.SHARE_NOT_FOUND, 'That share is no longer here.');

  if (row.fromUserId !== userId) {
    throw new HttpError(
      403,
      ERROR_CODES.SHARE_NOT_YOURS,
      'You can only withdraw a trip you shared.',
    );
  }

  if (row.acceptedAt) {
    throw new HttpError(
      409,
      ERROR_CODES.SHARE_REVOKED,
      'They already added this trip. It is theirs now.',
    );
  }

  const updated = await prisma.tripShare.update({
    where: { id: shareId },
    data: { revokedAt: row.revokedAt ?? new Date() },
  });

  return toApiShare(updated);
}

/**
 * The message carrying one share, for whichever end asks.
 *
 * Used after an accept or a withdrawal so both threads can be told what the
 * card now says — the sender's card changing from "Waiting" to "Added to their
 * trips" is the whole reward for having shared it.
 */
export async function messageForShare(shareId: string): Promise<ApiDirectMessage | null> {
  const message = await prisma.directMessage.findFirst({
    where: { shareId },
    include: { sender: { select: { name: true } }, share: true },
  });

  return message ? toApiMessage(message) : null;
}
