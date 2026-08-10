import type { PlannerMessage } from '../types/planner.types';
import { http } from './http';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * The planner conversation.
 *
 * The account owns it, so a conversation started on a laptop is there on a
 * phone. `localStorage` stays as a cache, for the same reason it does under
 * settings: `usePlanner` seeds its `useState` from this, so a conversation
 * arriving a moment after mount would be a visible flash of the empty seed
 * conversation before the real one replaced it.
 *
 * So `getMessages` stays synchronous and possibly one load stale, and writes
 * go to the server with the cache updated alongside.
 */

/**
 * Bump when the stored shape changes. A record from an older version is
 * dropped rather than half-read, so a schema change can never surface as a
 * broken conversation.
 */
const CHAT_HISTORY_VERSION = 1;

type StoredChatHistory = {
  version: number;
  messages: PlannerMessage[];
};

function isCompatible(stored: StoredChatHistory | null): stored is StoredChatHistory {
  return (
    stored !== null &&
    stored.version === CHAT_HISTORY_VERSION &&
    Array.isArray(stored.messages) &&
    stored.messages.length > 0
  );
}

function writeCache(messages: PlannerMessage[]): void {
  try {
    storageService.set<StoredChatHistory>(STORAGE_KEYS.chatHistory, {
      version: CHAT_HISTORY_VERSION,
      messages,
    });
  } catch {
    // Full or blocked storage. The conversation is on the server; only the
    // instant resume on the next load degrades.
  }
}

export const chatService = {
  /**
   * Stored conversation, or `fallback` when there is nothing usable saved.
   *
   * Reads the cache, never the network — this is what the planner needs before
   * anything has loaded.
   */
  getMessages(fallback: PlannerMessage[]): PlannerMessage[] {
    const stored = storageService.get<StoredChatHistory | null>(STORAGE_KEYS.chatHistory, null);

    return isCompatible(stored) ? stored.messages : fallback;
  },

  /**
   * Records the conversation.
   *
   * Fire-and-forget, and the cache is written first. A dropped save costs the
   * reader nothing they can see — the conversation is still on screen and
   * still on this device — where blocking each turn on a round trip would make
   * the planner feel slow for no benefit.
   */
  saveMessages(messages: PlannerMessage[]): void {
    writeCache(messages);

    void http.put<void>('/conversations/current', { messages }).catch(() => undefined);
  },

  /** Adopt the conversation that came back from the server. */
  adopt(messages: PlannerMessage[]): void {
    if (messages.length === 0) return;

    writeCache(messages);
  },

  /** Re-read from the server, for a conversation continued on another device. */
  async load(): Promise<PlannerMessage[]> {
    const { messages } = await http.get<{ messages: PlannerMessage[] }>('/conversations/current');

    chatService.adopt(messages);

    return messages;
  },

  clear(): void {
    storageService.remove(STORAGE_KEYS.chatHistory);

    void http.delete<void>('/conversations/current').catch(() => undefined);
  },

  /** Sign-out: forget this account's conversation without deleting it. */
  clearCache(): void {
    storageService.remove(STORAGE_KEYS.chatHistory);
  },

  /** Fires for writes in this tab and in other tabs. */
  subscribe(listener: () => void): () => void {
    return storageService.subscribe(STORAGE_KEYS.chatHistory, listener);
  },
};
