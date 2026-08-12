import type { ApiConversation } from '@ai-travel/shared';

/**
 * The people list, in the order it reads best.
 *
 * Pure, and in its own file for the reason the other `*.filters.ts` modules
 * are: ordering rules are the part worth asserting directly, and a test that
 * has to render a panel to check that online people come first is testing the
 * wrong thing.
 */

export type Conversation = ApiConversation & {
  isOnline: boolean;
};

/**
 * Online first, then whoever was spoken to most recently, then alphabetical.
 *
 * Three keys rather than the roster's two, because this list is a place you go
 * to *find* somebody rather than a note about who is around. Online first
 * because messaging somebody who is here gets an answer now; recency next
 * because a conversation in progress is almost always the one being looked
 * for; alphabetical last so that everyone else — and on a new account that is
 * everyone — sits in an order that can be scanned.
 *
 * The reader themselves is never in this list: `GET /messages/conversations`
 * excludes them, because messaging yourself is not a feature.
 */
export function groupConversations(
  conversations: ApiConversation[],
  onlineIds: string[],
): Conversation[] {
  const online = new Set(onlineIds);

  return conversations
    .map((conversation) => ({ ...conversation, isOnline: online.has(conversation.id) }))
    .sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;

      const aAt = a.lastMessage?.createdAt;
      const bAt = b.lastMessage?.createdAt;

      // Somebody who has never been spoken to sorts below everybody who has,
      // rather than jumping the queue on a name.
      if (aAt !== bAt) {
        if (!aAt) return 1;
        if (!bAt) return -1;

        return aAt < bAt ? 1 : -1;
      }

      return a.name.localeCompare(b.name);
    });
}

/**
 * How many people are here now.
 *
 * Counted from the rows that have names rather than from `onlineIds`, so the
 * number never disagrees with the list underneath it — presence is instant and
 * the list is a request behind it.
 */
export function countOnline(conversations: Conversation[]): number {
  return conversations.filter((conversation) => conversation.isOnline).length;
}

/**
 * Everything waiting to be read, across every conversation.
 *
 * What the toggle in the page header counts. Per conversation the badge says
 * which thread to open; on the toggle the only useful question is whether
 * anything is waiting at all.
 */
export function countUnread(conversations: ApiConversation[]): number {
  return conversations.reduce((total, conversation) => total + conversation.unread, 0);
}

/** "You: on my way" — who said the last thing, in a line. */
export function previewOf(conversation: ApiConversation): string | null {
  if (!conversation.lastMessage) return null;

  return conversation.lastMessage.isMine
    ? `You: ${conversation.lastMessage.body}`
    : conversation.lastMessage.body;
}
