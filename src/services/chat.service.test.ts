/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlannerMessage } from '../types/planner.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { chatService } from './chat.service';

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
