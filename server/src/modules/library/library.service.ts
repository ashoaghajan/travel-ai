import type { SaveActivityBody, SaveSearchBody } from '@ai-travel/shared/schemas';
import { Prisma } from '@prisma/client';
import type { RecentSearch, SavedActivity } from '@prisma/client';
import { prisma } from '../../prisma';

/**
 * Saved attractions, recent searches and the planner conversation.
 *
 * Three small domains in one module because none of them is big enough for its
 * own, and they share a property worth stating once: each is a *shortlist*,
 * not an archive. All three are capped, and the caps are enforced here rather
 * than only on the client — where they lived before, a second device would
 * grow the list straight past them.
 */

/* --------------------------------------------------------- saved activities */

/** A shortlist, not an archive. Matches the client's own former limit. */
const MAX_SAVED = 200;

export type ApiSavedActivity = {
  activity: unknown;
  /** ISO timestamp of when it was saved. */
  savedAt: string;
};

function toApiSavedActivity(row: SavedActivity): ApiSavedActivity {
  return { activity: row.activity, savedAt: row.savedAt.toISOString() };
}

export async function listSavedActivities(userId: string): Promise<ApiSavedActivity[]> {
  const rows = await prisma.savedActivity.findMany({
    where: { userId },
    orderBy: { savedAt: 'desc' },
    take: MAX_SAVED,
  });

  return rows.map(toApiSavedActivity);
}

/**
 * Saves an attraction, or refreshes the copy already held.
 *
 * An upsert rather than an insert: re-saving something moves it to the top of
 * the shortlist, which is what the reader means by the action, and duplicating
 * it is not.
 */
export async function saveActivity(
  userId: string,
  activityId: string,
  body: SaveActivityBody,
): Promise<ApiSavedActivity[]> {
  const savedAt = body.savedAt ? new Date(body.savedAt) : new Date();
  const when = Number.isNaN(savedAt.getTime()) ? new Date() : savedAt;

  const fields = {
    category: body.activity.category,
    title: body.activity.title,
    activity: body.activity as Prisma.InputJsonValue,
    savedAt: when,
  };

  await prisma.savedActivity.upsert({
    where: { userId_activityId: { userId, activityId } },
    create: { userId, activityId, ...fields },
    update: fields,
  });

  await trimSavedActivities(userId);

  return listSavedActivities(userId);
}

/**
 * Drops the oldest beyond the cap.
 *
 * After the write rather than before, so the row just saved is never the one
 * evicted — the reader would have watched their own action undo itself.
 */
async function trimSavedActivities(userId: string): Promise<void> {
  const surplus = await prisma.savedActivity.findMany({
    where: { userId },
    orderBy: { savedAt: 'desc' },
    skip: MAX_SAVED,
    select: { id: true },
  });

  if (surplus.length === 0) return;

  await prisma.savedActivity.deleteMany({ where: { id: { in: surplus.map((row) => row.id) } } });
}

export async function removeSavedActivity(
  userId: string,
  activityId: string,
): Promise<ApiSavedActivity[]> {
  // Idempotent: removing one already gone is the outcome the caller wanted.
  await prisma.savedActivity.deleteMany({ where: { userId, activityId } });

  return listSavedActivities(userId);
}

export async function clearSavedActivities(userId: string): Promise<void> {
  await prisma.savedActivity.deleteMany({ where: { userId } });
}

/* ---------------------------------------------------------- recent searches */

/** Five is what the screen shows; more would be a history nobody asked for. */
const MAX_RECENT = 5;

/**
 * The server-side form of the client's `isSameFlightSearch`.
 *
 * The same route on the same dates for the same party is one search, not
 * several — otherwise running a search twice fills the whole shortlist with
 * one entry. A string rather than a comparison so the database can enforce it.
 */
export function fingerprintOf(query: SaveSearchBody['query']): string {
  return [
    query.tripType,
    query.from.trim().toUpperCase(),
    query.to.trim().toUpperCase(),
    query.departDate,
    query.returnDate ?? '',
    query.travellers,
  ].join('|');
}

function toApiSearch(row: RecentSearch): unknown {
  return row.query;
}

export async function listFlightSearches(userId: string): Promise<unknown[]> {
  const rows = await prisma.recentSearch.findMany({
    where: { userId, kind: 'flight' },
    orderBy: { searchedAt: 'desc' },
    take: MAX_RECENT,
  });

  return rows.map(toApiSearch);
}

export async function saveFlightSearch(
  userId: string,
  body: SaveSearchBody,
): Promise<unknown[]> {
  const searchedAt = body.searchedAt ? new Date(body.searchedAt) : new Date();
  const when = Number.isNaN(searchedAt.getTime()) ? new Date() : searchedAt;
  const fingerprint = fingerprintOf(body.query);

  await prisma.recentSearch.upsert({
    where: { userId_kind_fingerprint: { userId, kind: 'flight', fingerprint } },
    // Re-running a search moves it to the top rather than adding a second row.
    create: {
      userId,
      kind: 'flight',
      fingerprint,
      query: body.query as Prisma.InputJsonValue,
      searchedAt: when,
    },
    update: { query: body.query as Prisma.InputJsonValue, searchedAt: when },
  });

  const surplus = await prisma.recentSearch.findMany({
    where: { userId, kind: 'flight' },
    orderBy: { searchedAt: 'desc' },
    skip: MAX_RECENT,
    select: { id: true },
  });

  if (surplus.length > 0) {
    await prisma.recentSearch.deleteMany({ where: { id: { in: surplus.map((row) => row.id) } } });
  }

  return listFlightSearches(userId);
}

export async function clearSearches(userId: string): Promise<void> {
  await prisma.recentSearch.deleteMany({ where: { userId } });
}

/* ------------------------------------------------------------- chat history */

export async function getChatHistory(userId: string): Promise<unknown[]> {
  const row = await prisma.chatHistory.findUnique({ where: { userId } });
  const messages = row?.messages;

  // An account that has never opened the planner has no row, which is an
  // empty conversation rather than a missing one.
  return Array.isArray(messages) ? messages : [];
}

/**
 * Replaces the conversation wholesale.
 *
 * A whole-list write rather than an append, because that is how the planner
 * uses it: a turn can edit the message before it — an AI reply gaining its
 * trip draft once generation finishes — so appending would leave the stored
 * copy behind the one on screen.
 */
export async function saveChatHistory(userId: string, messages: unknown[]): Promise<void> {
  const value = messages as Prisma.InputJsonValue;

  await prisma.chatHistory.upsert({
    where: { userId },
    create: { userId, messages: value },
    update: { messages: value },
  });
}

export async function clearChatHistory(userId: string): Promise<void> {
  await prisma.chatHistory.deleteMany({ where: { userId } });
}
