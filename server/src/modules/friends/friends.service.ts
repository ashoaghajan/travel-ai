import { ERROR_CODES, PEOPLE_SEARCH_LIMIT } from '@ai-travel/shared';
import type {
  ApiFriend,
  ApiFriendRequests,
  ApiFriendStats,
  ApiPerson,
  FriendStatus,
} from '@ai-travel/shared';
import { HttpError, notFound } from '../../errors';
import { prisma } from '../../prisma';
import { pairKeyOf } from '../messages/messages.service';

/**
 * Friends: asking, accepting, and undoing any of it.
 *
 * One row per pair, keyed by `pairKey` exactly as a conversation is, holding a
 * request while it is pending and the friendship once it is accepted. The same
 * row throughout, because a request *becomes* a friendship — two tables would
 * need a transaction to move a row between them and a rule for which one to
 * believe in the meantime.
 *
 * Everything below is written from the reader's side. `outgoing` means they
 * asked; `incoming` means somebody asked them. A single "pending" would leave
 * every screen working out which of the two it was looking at.
 */

type FriendshipRow = {
  requesterId: string;
  addresseeId: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
};

/** Where `userId` stands, given the row between them (or the absence of one). */
function statusFor(userId: string, row: FriendshipRow | null): FriendStatus {
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';

  return row.requesterId === userId ? 'outgoing' : 'incoming';
}

/** The other end of a row, whichever end the reader is. */
function otherEndOf(userId: string, row: FriendshipRow): string {
  return row.requesterId === userId ? row.addresseeId : row.requesterId;
}

/**
 * Whether two accounts may talk.
 *
 * The one question the messages module asks of this one. Exported rather than
 * reimplemented there, so "what counts as a friend" has a single answer.
 */
export async function areFriends(userId: string, otherUserId: string): Promise<boolean> {
  const row = await prisma.friendship.findUnique({
    where: { pairKey: pairKeyOf(userId, otherUserId) },
    select: { status: true },
  });

  return row?.status === 'accepted';
}

/** That the other person exists, and is not the reader. */
async function requireOther(userId: string, otherUserId: string): Promise<void> {
  if (userId === otherUserId) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'You are already your own company.');
  }

  const exists = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
  if (!exists) throw notFound('That person is no longer here.');
}

/**
 * Asks somebody to be friends — or accepts, if they asked first.
 *
 * The second case is not a special case so much as the obvious reading: two
 * people who have each pressed Add on the other have plainly agreed, and
 * making one of them find the other's request to press a different button
 * would be pedantry.
 *
 * Idempotent otherwise. Pressing Add twice returns the request already
 * standing, and pressing it on an existing friend changes nothing.
 */
export async function requestFriend(userId: string, otherUserId: string): Promise<FriendStatus> {
  await requireOther(userId, otherUserId);

  const pairKey = pairKeyOf(userId, otherUserId);
  const existing = await prisma.friendship.findUnique({ where: { pairKey } });

  if (existing) {
    // They asked first: this press means yes.
    if (existing.status === 'pending' && existing.addresseeId === userId) {
      return acceptRequest(userId, otherUserId);
    }

    return statusFor(userId, existing);
  }

  await prisma.friendship.create({
    data: { pairKey, requesterId: userId, addresseeId: otherUserId, status: 'pending' },
  });

  return 'outgoing';
}

/**
 * Accepts a request somebody made.
 *
 * Only the addressee, and only while it is pending: accepting your own request
 * would be a way to add anybody without asking, which is the one thing this
 * whole feature exists to prevent.
 */
export async function acceptRequest(userId: string, otherUserId: string): Promise<FriendStatus> {
  const pairKey = pairKeyOf(userId, otherUserId);
  const existing = await prisma.friendship.findUnique({ where: { pairKey } });

  if (!existing || existing.addresseeId !== userId || existing.status !== 'pending') {
    // Already friends is not a failure — it is the state they were asking for.
    if (existing?.status === 'accepted') return 'friends';

    throw new HttpError(
      404,
      ERROR_CODES.FRIEND_REQUEST_NOT_FOUND,
      'That friend request is no longer here.',
    );
  }

  await prisma.friendship.update({
    where: { pairKey },
    data: { status: 'accepted', respondedAt: new Date() },
  });

  return 'friends';
}

/**
 * Cancels, declines or unfriends — all of which are this row leaving.
 *
 * One function because they are one fact: the connection stops existing. Three
 * endpoints would be three names for it, and the caller would have to know
 * which of them applied, which is precisely what the row already knows.
 *
 * Nothing records that it happened. A declined request leaves no trace on
 * either side, which is deliberate — see the plan's recorded consequences.
 */
export async function removeFriend(userId: string, otherUserId: string): Promise<void> {
  const pairKey = pairKeyOf(userId, otherUserId);
  const existing = await prisma.friendship.findUnique({ where: { pairKey } });

  // Either end may do this, and it is idempotent: pressing Remove on somebody
  // who has already removed you is not an error, it is agreement.
  if (!existing) return;
  if (existing.requesterId !== userId && existing.addresseeId !== userId) return;

  await prisma.friendship.delete({ where: { pairKey } });
}

/** Everyone the reader may talk to, by name. */
export async function listFriends(userId: string): Promise<ApiFriend[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: { select: { id: true, name: true } },
      addressee: { select: { id: true, name: true } },
    },
  });

  return rows
    .map((row) => {
      const other = row.requesterId === userId ? row.addressee : row.requester;

      return {
        id: other.id,
        name: other.name,
        // Falls back to when it was asked for: rows backfilled from existing
        // conversations were never formally answered.
        since: (row.respondedAt ?? row.createdAt).toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The two halves of the requests screen.
 *
 * Fetched together because they are one screen and one question — "what is
 * outstanding" — and two round trips for two halves of a list nobody reads
 * separately would be two chances to disagree.
 */
export async function listRequests(userId: string): Promise<ApiFriendRequests> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'pending',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: { select: { id: true, name: true } },
      addressee: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const toRequest = (row: (typeof rows)[number]) => {
    const other = row.requesterId === userId ? row.addressee : row.requester;

    return { id: other.id, name: other.name, createdAt: row.createdAt.toISOString() };
  };

  return {
    incoming: rows.filter((row) => row.addresseeId === userId).map(toRequest),
    outgoing: rows.filter((row) => row.requesterId === userId).map(toRequest),
  };
}

/**
 * Everybody, with where the reader stands with each of them.
 *
 * **This is the one place accounts stay enumerable**, and it is the price of
 * being able to find anybody at all: a friends-only product where you cannot
 * search for a friend is a product with no friends in it. Names only, capped,
 * and the reader is never in their own results.
 */
export async function searchPeople(
  userId: string,
  { q, limit = PEOPLE_SEARCH_LIMIT }: { q?: string; limit?: number } = {},
): Promise<ApiPerson[]> {
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

  const rows = await prisma.friendship.findMany({
    where: { pairKey: { in: people.map((person) => pairKeyOf(userId, person.id)) } },
  });

  const byOther = new Map(rows.map((row) => [otherEndOf(userId, row), row]));

  return people.map((person) => ({
    id: person.id,
    name: person.name,
    status: statusFor(userId, byOther.get(person.id) ?? null),
  }));
}

/**
 * The counts the profile shows.
 *
 * Four `count` queries rather than four lists: the profile wants numbers, and
 * fetching every friend to call `.length` on them is the kind of thing that is
 * free until the day it is not.
 */
export async function friendStats(userId: string): Promise<ApiFriendStats> {
  const [friends, incoming, outgoing, totalUsers] = await Promise.all([
    prisma.friendship.count({
      where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    }),
    prisma.friendship.count({ where: { status: 'pending', addresseeId: userId } }),
    prisma.friendship.count({ where: { status: 'pending', requesterId: userId } }),
    prisma.user.count(),
  ]);

  return { friends, incoming, outgoing, totalUsers };
}
