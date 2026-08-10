/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlannerMessage } from '../types/planner.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { chatService } from './chat.service';
import { http } from './http';

const SEED: PlannerMessage[] = [{ id: 'seed', author: 'ai', content: 'Where to?' }];

const conversation: PlannerMessage[] = [
  { id: 'm1', author: 'user', content: 'Five days in Lisbon' },
  { id: 'm2', author: 'ai', content: 'Here you go:' },
];

describe('getMessages', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(chatService.getMessages(SEED)).toBe(SEED);
  });

  it('returns the stored conversation', () => {
    chatService.saveMessages(conversation);
    expect(chatService.getMessages(SEED)).toEqual(conversation);
  });

  it('falls back when the stored conversation is empty', () => {
    chatService.saveMessages([]);
    expect(chatService.getMessages(SEED)).toBe(SEED);
  });

  it('falls back when the stored version is older', () => {
    storageService.set(STORAGE_KEYS.chatHistory, { version: 0, messages: conversation });
    expect(chatService.getMessages(SEED)).toBe(SEED);
  });

  it('falls back when the record has no messages array', () => {
    storageService.set(STORAGE_KEYS.chatHistory, { version: 1, messages: 'nope' });
    expect(chatService.getMessages(SEED)).toBe(SEED);
  });

  it('falls back when the stored value is corrupt', () => {
    localStorage.setItem(STORAGE_KEYS.chatHistory, 'not json');
    expect(chatService.getMessages(SEED)).toBe(SEED);
  });

  it('preserves an attached trip draft', () => {
    const withTrip: PlannerMessage[] = [
      {
        id: 'm1',
        author: 'ai',
        content: 'Here you go:',
        trip: {
          draftId: 'draft_1',
          title: 'Bali Adventure',
          destination: 'Bali',
          startDate: '2027-05-20',
          endDate: '2027-05-26',
          travellers: 2,
          coverImage: '/bali.jpg',
          itinerary: [],
        },
      },
    ];

    chatService.saveMessages(withTrip);

    expect(chatService.getMessages(SEED)[0].trip?.draftId).toBe('draft_1');
  });
});

describe('saveMessages', () => {
  it('stamps the record with a version', () => {
    chatService.saveMessages(conversation);

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.chatHistory) ?? '{}');
    expect(raw.version).toBe(1);
  });

  it('replaces the previous conversation', () => {
    chatService.saveMessages(conversation);
    chatService.saveMessages([conversation[0]]);

    expect(chatService.getMessages(SEED)).toHaveLength(1);
  });
});

describe('clear', () => {
  it('removes the stored conversation', () => {
    chatService.saveMessages(conversation);
    chatService.clear();

    expect(chatService.getMessages(SEED)).toBe(SEED);
    expect(localStorage.getItem(STORAGE_KEYS.chatHistory)).toBeNull();
  });
});

describe('subscribe', () => {
  it('fires when the conversation is written', () => {
    const listener = vi.fn();
    const unsubscribe = chatService.subscribe(listener);

    chatService.saveMessages(conversation);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fires when another tab writes the conversation', () => {
    const listener = vi.fn();
    const unsubscribe = chatService.subscribe(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.chatHistory }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('the account\'s copy', () => {
  it('sends the conversation to the server', () => {
    const put = vi.spyOn(http, 'put').mockResolvedValue(undefined);

    chatService.saveMessages(conversation);

    expect(put).toHaveBeenCalledWith('/conversations/current', { messages: conversation });
  });

  it('keeps the conversation on screen when the save fails', async () => {
    vi.spyOn(http, 'put').mockRejectedValue(new Error('offline'));

    // Fire-and-forget: a dropped save costs the reader nothing they can see,
    // where blocking each turn on a round trip would make the planner slow.
    expect(() => chatService.saveMessages(conversation)).not.toThrow();
    expect(chatService.getMessages([])).toEqual(conversation);
  });

  it('adopts what the server holds', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ messages: [{ id: 'remote', author: 'ai', content: 'From the server' }] });

    await chatService.load();

    expect(chatService.getMessages([])).toEqual([
      { id: 'remote', author: 'ai', content: 'From the server' },
    ]);
  });

  it('does not overwrite the cache with an empty conversation', () => {
    chatService.saveMessages(conversation);

    // A new device reading an account that has never used the planner would
    // otherwise wipe the conversation this browser is holding.
    chatService.adopt([]);

    expect(chatService.getMessages([])).toEqual(conversation);
  });

  it('tells the server when the conversation is cleared', () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    chatService.clear();

    expect(remove).toHaveBeenCalledWith('/conversations/current');
  });

  it('forgets the cache on sign-out without deleting the conversation', () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);
    chatService.saveMessages(conversation);

    chatService.clearCache();

    expect(chatService.getMessages([])).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
