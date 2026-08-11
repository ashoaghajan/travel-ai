import type { ApiLobbyMessage, ApiLobbyPerson } from '@ai-travel/shared';
import { http } from './http';

/**
 * The lobby's HTTP half.
 *
 * No React component may import this file.
 *
 * Thin on purpose. Everything interesting about the room — reconciling an
 * optimistic bubble with the row that comes back, ordering, retries — belongs
 * to the store, because none of it is about the wire.
 */
export const lobbyService = {
  /** The tail of the conversation, oldest first. */
  async getMessages(): Promise<ApiLobbyMessage[]> {
    return http.get<ApiLobbyMessage[]>('/lobby/messages');
  },

  /**
   * Sends a message.
   *
   * `clientMessageId` is minted by the caller rather than here: the same id
   * has to survive a retry, and a value invented per call could not.
   */
  async sendMessage(body: string, clientMessageId: string): Promise<ApiLobbyMessage> {
    return http.post<ApiLobbyMessage>('/lobby/messages', { body, clientMessageId });
  },

  async deleteMessage(id: string): Promise<void> {
    await http.delete<void>(`/lobby/messages/${encodeURIComponent(id)}`);
  },

  async getPeople(): Promise<ApiLobbyPerson[]> {
    return http.get<ApiLobbyPerson[]>('/lobby/people');
  },

  /**
   * A short-lived token letting this browser listen to the room.
   *
   * Signed by our server from a key the browser never sees, pinned to this
   * account, and good for listening only — it cannot publish. Ably asks for a
   * fresh one shortly before each expires, and because that goes through
   * `http` it also renews this app's own access token on the way.
   */
  async getRealtimeToken(): Promise<unknown> {
    return http.get<unknown>('/lobby/token');
  },
};
