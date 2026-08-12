import { describe, expect, it } from 'vitest';
import type { ApiConversation } from '@ai-travel/shared';
import { countOnline, countUnread, groupConversations, previewOf } from './conversation.filters';

function person(
  id: string,
  name: string,
  { at, unread = 0, isMine = false }: { at?: string; unread?: number; isMine?: boolean } = {},
): ApiConversation {
  return {
    id,
    name,
    lastMessage: at ? { body: 'hey', createdAt: at, isMine } : null,
    unread,
  };
}

const PEOPLE = [person('u_zoe', 'Zoe'), person('u_adam', 'Adam'), person('u_mia', 'Mia')];

describe('groupConversations', () => {
  it('puts the people who are here first', () => {
    const list = groupConversations(PEOPLE, ['u_mia']);

    expect(list.map((entry) => entry.name)).toEqual(['Mia', 'Adam', 'Zoe']);
  });

  it('sorts alphabetically among people never spoken to', () => {
    const list = groupConversations(PEOPLE, ['u_zoe', 'u_mia']);

    expect(list.map((entry) => entry.name)).toEqual(['Mia', 'Zoe', 'Adam']);
  });

  it('puts the most recent conversation above an older one', () => {
    const list = groupConversations(
      [
        person('u_a', 'Adam', { at: '2026-08-11T09:00:00.000Z' }),
        person('u_z', 'Zoe', { at: '2026-08-11T10:00:00.000Z' }),
      ],
      [],
    );

    // A conversation in progress is almost always the one being looked for.
    expect(list.map((entry) => entry.name)).toEqual(['Zoe', 'Adam']);
  });

  it('sorts somebody never spoken to below everybody who has been', () => {
    const list = groupConversations(
      [person('u_a', 'Adam'), person('u_z', 'Zoe', { at: '2026-08-11T10:00:00.000Z' })],
      [],
    );

    expect(list.map((entry) => entry.name)).toEqual(['Zoe', 'Adam']);
  });

  it('keeps online above recency', () => {
    const list = groupConversations(
      [
        person('u_a', 'Adam', { at: '2026-08-11T09:00:00.000Z' }),
        person('u_z', 'Zoe', { at: '2026-08-11T10:00:00.000Z' }),
      ],
      ['u_a'],
    );

    // Messaging somebody who is here gets an answer now; a fresher thread with
    // somebody who has gone does not.
    expect(list.map((entry) => entry.name)).toEqual(['Adam', 'Zoe']);
  });

  it('marks who is online', () => {
    const list = groupConversations(PEOPLE, ['u_adam']);

    expect(list.find((entry) => entry.id === 'u_adam')?.isOnline).toBe(true);
    expect(list.find((entry) => entry.id === 'u_zoe')?.isOnline).toBe(false);
  });

  it('ignores an online id nobody has a name for', () => {
    // Presence is instant and the list is a request behind it. A blank row is
    // worse than a row that appears a moment later.
    const list = groupConversations(PEOPLE, ['u_stranger']);

    expect(list).toHaveLength(3);
    expect(list.every((entry) => !entry.isOnline)).toBe(true);
  });

  it('leaves the original list alone', () => {
    const original = [...PEOPLE];
    groupConversations(PEOPLE, ['u_mia']);

    expect(PEOPLE).toEqual(original);
  });
});

describe('countOnline', () => {
  it('counts the rows that are here', () => {
    expect(countOnline(groupConversations(PEOPLE, ['u_mia', 'u_zoe']))).toBe(2);
  });

  it('counts nobody when the connection is down', () => {
    expect(countOnline(groupConversations(PEOPLE, []))).toBe(0);
  });
});

describe('countUnread', () => {
  it('adds up every conversation', () => {
    expect(countUnread([person('u_a', 'Adam', { unread: 2 }), person('u_z', 'Zoe', { unread: 3 })])).toBe(5);
  });

  it('counts nothing when everything has been read', () => {
    expect(countUnread(PEOPLE)).toBe(0);
  });
});

describe('previewOf', () => {
  it('says who spoke last when it was the reader', () => {
    expect(previewOf(person('u_a', 'Adam', { at: '2026-08-11T10:00:00.000Z', isMine: true }))).toBe(
      'You: hey',
    );
  });

  it('leaves the other person’s words as they are', () => {
    expect(previewOf(person('u_a', 'Adam', { at: '2026-08-11T10:00:00.000Z' }))).toBe('hey');
  });

  it('has nothing to say about a conversation that has not started', () => {
    expect(previewOf(person('u_a', 'Adam'))).toBeNull();
  });
});
