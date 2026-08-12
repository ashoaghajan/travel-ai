import { ERROR_CODES, CONVERSATION_LIMIT, THREAD_LIMIT } from '@ai-travel/shared';
import type { ApiConversation, ApiDirectMessage } from '@ai-travel/shared';
import { HttpError, notFound } from '../../errors';
import { prisma } from '../../prisma';

/**
 * Direct messages: one private conversation per pair of accounts.
 *
 * No Express in here. Everything below takes ids and returns data, which is
 * what lets the route file stay a list of short handlers.
 *
 * Replaced the service behind the app's one public room, shared by
 * everybody. The
 * room needed no membership because there was one of it; a conversation has
 * exactly two members, and every query below is scoped by that fact rather
 * than by a check somewhere else.
 */

/**
 * A conversation's identity: the two ids, ordered, joined.
 *
 * Ordered because a conversation is an unordered pair — A→B and B→A are the
 * same thread — and a single sorted key is what lets one index serve it. See
 * `DirectMessage.pairKey`.
 */
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * A row with its sender's name attached.
 *
 * `select: { name: true }` rather than including the user is the enforcement
 * point for this feature's one privacy rule: an account's email must never
 * reach another account's screen, and the way to guarantee that is to never
 * load it in the first place.
 */
const WITH_SENDER = { sender: { select: { name: true } } } as const;

type MessageRow = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  clientMessageId: string;
  createdAt: Date;
  sender: { name: string };
};

export function toApiMessage(row: MessageRow): ApiDirectMessage {
  return {
    id: row.id,
    senderId: row.senderId,
    recipientId: row.recipientId,
    senderName: row.sender.name,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    clientMessageId: row.clientMessageId,
  };
}

/** That the other person exists, before anything is written against them. */
async function requireRecipient(userId: string, otherUserId: string): Promise<void> {
  if (userId === otherUserId) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'You cannot message yourself.');
  }

  const exists = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
  if (!exists) throw notFound('That person is no longer here.');
}

/**
 * The tail of one conversation, oldest first.
 *
 * Queried newest-first because that is what the index serves, then reversed —
 * the client renders top to bottom and should never have to think about it.
 */
export async function listThread(
  userId: string,
  otherUserId: string,
  limit = THREAD_LIMIT,
): Promise<ApiDirectMessage[]> {
  await requireRecipient(userId, otherUserId);

  const rows = await prisma.directMessage.findMany({
    where: { pairKey: pairKeyOf(userId, otherUserId), deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: WITH_SENDER,
  });

  return rows.reverse().map(toApiMessage);
}

/**
 * Writes a message, or returns the one this send already produced.
 *
 * The `upsert` is the whole retry story, and it is unchanged from the public
 * room's:
 * a cold instance can take a minute to answer, by which time the reader has
 * pressed the button again. `update: {}` means the second attempt changes
 * nothing and hands back the first message, so a retry is safe however many
 * times it happens.
 */
export async function createMessage(
  senderId: string,
  recipientId: string,
  body: string,
  clientMessageId: string,
): Promise<ApiDirectMessage> {
  await requireRecipient(senderId, recipientId);

  const row = await prisma.directMessage.upsert({
    where: { senderId_clientMessageId: { senderId, clientMessageId } },
    update: {},
    create: {
      senderId,
      recipientId,
      // Computed here from the authenticated sender, never taken from a client.
      pairKey: pairKeyOf(senderId, recipientId),
      body,
      clientMessageId,
    },
    include: WITH_SENDER,
  });

  return toApiMessage(row);
}

/**
 * Withdraws a message.
 *
 * Soft, so an id already sitting on the other person's screen still resolves
 * to something. Scoped by author, and the two failures are told apart on
 * purpose: a message that is not yours is a 403, not the 404 a trip belonging
 * to someone else gets. There is no existence to conceal — you are looking at
 * it — and a 404 would only be baffling.
 */
export async function deleteMessage(userId: string, messageId: string): Promise<ApiDirectMessage> {
  const row = await prisma.directMessage.findFirst({
    where: { id: messageId, deletedAt: null },
    include: WITH_SENDER,
  });

  if (!row) throw notFound('That message is no longer here.');

  if (row.senderId !== userId) {
    throw new HttpError(403, ERROR_CODES.MESSAGE_NOT_YOURS, 'You can only delete your own messages.');
  }

  await prisma.directMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  // Returned so the route can tell the other person's inbox about it too.
  return toApiMessage(row);
}

/** Marks everything said so far in one conversation as read. */
export async function markRead(userId: string, otherUserId: string): Promise<void> {
  await requireRecipient(userId, otherUserId);

  const lastReadAt = new Date();

  await prisma.conversationRead.upsert({
    where: { userId_otherUserId: { userId, otherUserId } },
    update: { lastReadAt },
    create: { userId, otherUserId, lastReadAt },
  });
}

/**
 * Everyone you could talk to, with the state of that conversation.
 *
 * **Every account, not only the ones you have written to.** This is the one
 * place this feature is deliberately broader than the room it replaced, which
 * listed only people who had posted precisely so accounts were not
 * enumerable — a rule a direct-message product cannot keep, because you cannot
 * message somebody you cannot find. Names only; an email is never selected.
 *
 * Three queries rather than one join, and on purpose: the newest message per
 * pair and the unread count per sender are both aggregates over the same
 * table, and expressing them together needs a lateral join Prisma cannot
 * write. Two grouped queries over an indexed column are cheaper to understand
 * and, at this size, to run.
 */
export async function listConversations(
  userId: string,
  { q, limit = CONVERSATION_LIMIT }: { q?: string; limit?: number } = {},
): Promise<ApiConversation[]> {
  const people = await prisma.user.findMany({
    where: {
      id: { not: userId },
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: limit,
  });

  if (people.length === 0) return [];

  const ids = people.map((person) => person.id);

  const [latest, cursors] = await Promise.all([
    // Every message either way with these people. Bounded by `take` on the
    // newest, which is all the previews need.
    prisma.directMessage.findMany({
      where: {
        deletedAt: null,
        pairKey: { in: ids.map((id) => pairKeyOf(userId, id)) },
      },
      orderBy: { createdAt: 'desc' },
      select: { pairKey: true, senderId: true, body: true, createdAt: true },
      take: limit * 4,
    }),
    prisma.conversationRead.findMany({
      where: { userId, otherUserId: { in: ids } },
      select: { otherUserId: true, lastReadAt: true },
    }),
  ]);

  const readAt = new Map(cursors.map((row) => [row.otherUserId, row.lastReadAt]));

  /** The newest message of each pair — the list is already newest-first. */
  const newest = new Map<string, (typeof latest)[number]>();
  for (const row of latest) {
    if (!newest.has(row.pairKey)) newest.set(row.pairKey, row);
  }

  const unread = await prisma.directMessage.groupBy({
    by: ['senderId'],
    where: {
      recipientId: userId,
      senderId: { in: ids },
      deletedAt: null,
      // A conversation never opened has no cursor, so everything in it counts.
      OR: ids.map((id) => ({
        senderId: id,
        ...(readAt.has(id) ? { createdAt: { gt: readAt.get(id) } } : {}),
      })),
    },
    _count: { _all: true },
  });

  const unreadBy = new Map(unread.map((row) => [row.senderId, row._count._all]));

  return people.map((person) => {
    const last = newest.get(pairKeyOf(userId, person.id));

    return {
      id: person.id,
      name: person.name,
      lastMessage: last
        ? {
            body: last.body,
            createdAt: last.createdAt.toISOString(),
            isMine: last.senderId === userId,
          }
        : null,
      unread: unreadBy.get(person.id) ?? 0,
    };
  });
}
