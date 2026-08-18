import type {
  ApiFriend,
  ApiFriendRequests,
  ApiFriendStats,
  ApiPerson,
  FriendStatus,
} from '@ai-travel/shared';
import { http } from './http';

/**
 * Friends, over HTTP.
 *
 * No React component may import this file.
 *
 * Thin, and thinner than most: a friendship has no fields, so every call but
 * the search names its subject in the path and sends no body at all.
 */
export const friendService = {
  /** Everyone the reader may talk to. */
  async getFriends(): Promise<ApiFriend[]> {
    return http.get<ApiFriend[]>('/friends');
  },

  /** Both halves of the requests screen, in one answer. */
  async getRequests(): Promise<ApiFriendRequests> {
    return http.get<ApiFriendRequests>('/friends/requests');
  },

  /** The counts the profile shows. */
  async getStats(): Promise<ApiFriendStats> {
    return http.get<ApiFriendStats>('/friends/stats');
  },

  /** Everybody, with where the reader stands with each of them. */
  async searchPeople(q?: string): Promise<ApiPerson[]> {
    return http.get<ApiPerson[]>('/friends/search', { query: q ? { q } : undefined });
  },

  /**
   * Asks somebody to be friends.
   *
   * Answers with where the caller now stands, which is not always `outgoing`:
   * asking somebody who already asked you accepts theirs.
   */
  async addFriend(userId: string): Promise<FriendStatus> {
    const { status } = await http.post<{ status: FriendStatus }>(
      `/friends/${encodeURIComponent(userId)}`,
    );

    return status;
  },

  async acceptFriend(userId: string): Promise<FriendStatus> {
    const { status } = await http.post<{ status: FriendStatus }>(
      `/friends/${encodeURIComponent(userId)}/accept`,
    );

    return status;
  },

  /** Cancel, decline or unfriend — one call, because they are one fact. */
  async removeFriend(userId: string): Promise<void> {
    await http.delete<void>(`/friends/${encodeURIComponent(userId)}`);
  },
};
