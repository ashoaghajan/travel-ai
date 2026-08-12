/**
 * Direct messages — one private conversation between two accounts.
 *
 * Not to be confused with `planner.types.ts`, which is the conversation
 * between one reader and the AI planner. Nothing here is named `chat` for that
 * reason: the word is already spoken for by the transcript.
 *
 * Replaced one public room everybody shared. The shape of
 * a message is nearly unchanged — the difference that matters is that it now
 * has a recipient, so who may read it is a fact about the row rather than
 * about the app.
 */

import type { ApiTripShare } from './share.types';

/** Everyone's presence lives on one channel, because the roster is everyone. */
export const PRESENCE_CHANNEL = 'presence:global';

/** One account's private inbox. The server publishes; nobody may. */
export function userChannel(userId: string): string {
  return `user:${userId}`;
}

/** Realtime event names, on a user's own channel. */
export const MESSAGE_EVENT_SENT = 'message';
export const MESSAGE_EVENT_DELETED = 'delete';
/** A shared trip changed state — taken up, or withdrawn. */
export const MESSAGE_EVENT_SHARE = 'share';

/**
 * The longest a message may be.
 *
 * Shared rather than duplicated because both halves need it and they must
 * agree: the composer counts down against it and refuses to send past it, and
 * the server rejects anything over it. Two copies drift, and the drift shows
 * up as a message the composer accepted and the server threw away.
 */
export const MESSAGE_MAX_LENGTH = 1000;

/** How much of a thread a newcomer is handed. */
export const THREAD_LIMIT = 50;

/** How many people the conversation list will name. */
export const CONVERSATION_LIMIT = 200;

export type ApiDirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  /**
   * The sender's display name, joined at read time rather than stored.
   *
   * Denormalising would freeze the name as it was when they sent it; joining
   * shows the one they have now.
   */
  senderName: string;
  body: string;
  /** ISO timestamp, from the one server clock — so every client sorts alike. */
  createdAt: string;
  /**
   * The id the sending browser minted. Echoed back so the sender can retire
   * the optimistic bubble it drew before the round trip finished.
   */
  clientMessageId: string;
  /**
   * Set when this message is a trip rather than words.
   *
   * The card, never the itinerary: a thread renders dozens of these and the
   * snapshot behind one is up to a megabyte. `GET /api/shares/:id` fetches
   * that, once, when somebody asks to look.
   *
   * `body` is still written and still means something — "Shared a trip: Berlin
   * in Early Autumn" is what the conversation list previews and what a screen
   * reader reads. A message the rest of the app cannot describe is a message
   * half the app renders as blank.
   */
  share?: ApiTripShare;
};

/**
 * Somebody you could talk to, and the state of that conversation.
 *
 * Every account appears, whether or not a word has passed between you — you
 * cannot message someone you cannot find. Name and id only: `ApiUser` carries
 * an email, and this is the projection that exists so it cannot reach a screen
 * every account can read.
 */
export type ApiConversation = {
  id: string;
  name: string;
  /** The newest message either way, or null when nothing has been said. */
  lastMessage: {
    body: string;
    createdAt: string;
    /** Whether the reader wrote it, so the list can say "You: …". */
    isMine: boolean;
  } | null;
  /** Messages from them, newer than this reader's cursor for this thread. */
  unread: number;
};
