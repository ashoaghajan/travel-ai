import type { ApiConversation, ApiDirectMessage } from '@ai-travel/shared';
import { http, keepWarm } from './http';

/**
 * Direct messages, over HTTP.
 *
 * No React component may import this file.
 *
 * Thin on purpose, as the public room's service was before it. Everything
 * interesting about a conversation — reconciling an optimistic bubble with the
 * row that comes back, ordering, retries, which thread an arriving message
 * belongs to — belongs to the store, because none of it is about the wire.
 *
 * Every path names the other person rather than a conversation id. A thread
 * has no identity of its own here: it is the pair, and the server derives its
 * `pairKey` from the authenticated caller and this path parameter, so a client
 * cannot name a conversation it is not in.
 */
export const messagesService = {
  /**
   * Everyone you could talk to, with the state of each conversation.
   *
   * Every account, not only the people already talked to — you cannot message
   * somebody you cannot find. `q` narrows it by name, which is what makes that
   * bearable once there are more than a screenful.
   */
  async getConversations(q?: string): Promise<ApiConversation[]> {
    return http.get<ApiConversation[]>('/messages/conversations', {
      query: q ? { q } : undefined,
    });
  },

  /** The tail of one conversation, oldest first. */
  async getThread(userId: string): Promise<ApiDirectMessage[]> {
    return http.get<ApiDirectMessage[]>(`/messages/with/${encodeURIComponent(userId)}`);
  },

  /**
   * Sends a message to one person.
   *
   * `clientMessageId` is minted by the caller rather than here: the same id has
   * to survive a retry, and a value invented per call could not.
   */
  async sendMessage(
    userId: string,
    body: string,
    clientMessageId: string,
  ): Promise<ApiDirectMessage> {
    return http.post<ApiDirectMessage>(`/messages/with/${encodeURIComponent(userId)}`, {
      body,
      clientMessageId,
    });
  },

  /**
   * Moves the read cursor for one conversation to now.
   *
   * A cursor on the server rather than a count in this tab, which is the one
   * thing the public room's unread badge could not do: reading a thread on a
   * phone has to clear the badge on the laptop too, and survive a reload on
   * both.
   */
  async markRead(userId: string): Promise<void> {
    await http.post<void>(`/messages/with/${encodeURIComponent(userId)}/read`);
  },

  /** Withdraws one of your own messages, from both ends of the conversation. */
  async deleteMessage(id: string): Promise<void> {
    await http.delete<void>(`/messages/${encodeURIComponent(id)}`);
  },

  /**
   * A short-lived token letting this browser listen to its own inbox.
   *
   * Signed by our server from a key the browser never sees, pinned to this
   * account, and good for listening only — it cannot publish anywhere, and it
   * cannot name anybody else's inbox. Ably asks for a fresh one shortly before
   * each expires, and because that goes through `http` it also renews this
   * app's own access token on the way.
   */
  async getRealtimeToken(): Promise<unknown> {
    return http.get<unknown>('/messages/token');
  },

  /**
   * Nudges the API awake because somebody is about to type.
   *
   * Messages are the only screen that can show a reader other people's words
   * arriving live while their own send hangs for a minute on a cold instance —
   * which reads as "broken for me specifically" rather than as a server waking
   * up. Focusing the composer is the earliest honest signal that a send is
   * coming, and it costs nothing when the API is already up.
   *
   * Fire-and-forget by design; see `keepWarm`.
   */
  wakeUp(): void {
    keepWarm();
  },
};
