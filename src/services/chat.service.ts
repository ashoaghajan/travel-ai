import type { PlannerMessage } from '../types/planner.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Planner conversation persistence.
 *
 * The conversation is device-local in Stage 1, so these are synchronous. In
 * Stage 2 the history moves server-side with the trip and this file becomes
 * the cache in front of it.
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

export const chatService = {
  /** Stored conversation, or `fallback` when there is nothing usable saved. */
  getMessages(fallback: PlannerMessage[]): PlannerMessage[] {
    const stored = storageService.get<StoredChatHistory | null>(STORAGE_KEYS.chatHistory, null);
    return isCompatible(stored) ? stored.messages : fallback;
  },

  saveMessages(messages: PlannerMessage[]): void {
    storageService.set<StoredChatHistory>(STORAGE_KEYS.chatHistory, {
      version: CHAT_HISTORY_VERSION,
      messages,
    });
  },

  clear(): void {
    storageService.remove(STORAGE_KEYS.chatHistory);
  },

  /** Fires for writes in this tab and in other tabs. */
  subscribe(listener: () => void): () => void {
    return storageService.subscribe(STORAGE_KEYS.chatHistory, listener);
  },
};
