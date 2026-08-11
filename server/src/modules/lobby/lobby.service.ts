import { ERROR_CODES } from '@ai-travel/shared';
import type { ApiLobbyMessage, ApiLobbyPerson } from '@ai-travel/shared';
import { HttpError, notFound } from '../../errors';
import { prisma } from '../../prisma';

/**
 * The lobby: one public room, shared by every account.
 *
 * No Express in here. Everything below takes ids and returns data, which is
 * what lets the route file stay a list of five short handlers.
 *
 * The room is deliberately thin. There are no participants to manage, no
 * membership to check and no ordering to negotiate, because there is exactly
 * one room and everybody with an account is in it.
 */

/** How much history a newcomer is handed. */
export const HISTORY_LIMIT = 50;

/** How many people the roster will name. */
const PEOPLE_LIMIT = 200;

/**
 * A row with its author's name attached.
 *
 * `select: { name: true }` rather than including the user is the enforcement
 * point for the room's one privacy rule: an account's email must never reach a
 * room that everybody can read, and the way to guarantee that is to never load
 * it in the first place.
 */
const WITH_AUTHOR = { user: { select: { name: true } } } as const;

type MessageRow = {
  id: string;
  userId: string;
  body: string;
  clientMessageId: string;
  createdAt: Date;
  user: { name: string };
};

export function toApiMessage(row: MessageRow): ApiLobbyMessage {
  return {
    id: row.id,
    userId: row.userId,
    authorName: row.user.name,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    clientMessageId: row.clientMessageId,
  };
}

/**
 * The tail of the conversation, oldest first.
 *
 * Queried newest-first because that is what the index serves, then reversed —
 * the client renders top to bottom and should never have to think about it.
 */
export async function listRecentMessages(limit = HISTORY_LIMIT): Promise<ApiLobbyMessage[]> {
  const rows = await prisma.lobbyMessage.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: WITH_AUTHOR,
  });

  return rows.reverse().map(toApiMessage);
}

/**
 * Writes a message, or returns the one this send already produced.
 *
 * The `upsert` is the whole retry story. A cold instance can take a minute to
 * answer, by which time the reader has pressed the button again — and without
 * this, the room would show what they typed twice. `update: {}` means the
 * second attempt changes nothing and hands back the first message, so a retry
 * is safe however many times it happens.
 */
export async function createMessage(
  userId: string,
  body: string,
  clientMessageId: string,
): Promise<ApiLobbyMessage> {
  const row = await prisma.lobbyMessage.upsert({
    where: { userId_clientMessageId: { userId, clientMessageId } },
    update: {},
    create: { userId, body, clientMessageId },
    include: WITH_AUTHOR,
  });

  return toApiMessage(row);
}

/**
 * Withdraws a message.
 *
 * Soft, so an id already sitting on other people's screens still resolves to
 * something. Scoped by author rather than fetched-then-checked, but the two
 * failures are told apart on purpose: a message that is not yours is a 403,
 * not the 404 a trip belonging to someone else gets. There is no existence to
 * conceal — you are looking at it — and a 404 would only be baffling.
 */
export async function deleteMessage(userId: string, messageId: string): Promise<void> {
  const row = await prisma.lobbyMessage.findFirst({
    where: { id: messageId, deletedAt: null },
    select: { userId: true },
  });

  if (!row) throw notFound('That message is no longer here.');

  if (row.userId !== userId) {
    throw new HttpError(403, ERROR_CODES.MESSAGE_NOT_YOURS, 'You can only delete your own messages.');
  }

  await prisma.lobbyMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });
}

/**
 * Who is in the room.
 *
 * People who have posted, plus anyone the caller reports as currently present.
 * Deliberately **not** every registered account: "everyone signed in can see
 * each other's names" is the room's bargain, but "every account that has ever
 * existed is enumerable by every other account" is a larger claim nobody made,
 * and it would list people who have never opened the panel.
 *
 * A newcomer still appears the instant they connect, because presence supplies
 * the second half of that union — see the realtime milestone.
 */
export async function listPeople(onlineIds: string[] = []): Promise<ApiLobbyPerson[]> {
  const authors = await prisma.lobbyMessage.findMany({
    where: { deletedAt: null },
    select: { userId: true },
    distinct: ['userId'],
    take: PEOPLE_LIMIT,
  });

  const ids = [...new Set([...authors.map((row) => row.userId), ...onlineIds])].slice(
    0,
    PEOPLE_LIMIT,
  );

  const people = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return people;
}
