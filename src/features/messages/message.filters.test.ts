import { describe, expect, it } from 'vitest';
import type { DirectMessage } from '../../store/messages.store';
import { dayLabel, groupThread, insertAt, isEmojiOnly } from './message.filters';

/**
 * What turns a column of islands into a conversation.
 *
 * Most of this is about *not* saying things twice: two messages a minute apart
 * do not each need a timestamp, and a date said once at the top of a day does
 * not need repeating on every line under it.
 */

const NOW = new Date('2026-08-12T12:00:00.000Z');

function message(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id: 'dm_1',
    senderId: 'u_them',
    recipientId: 'u_me',
    senderName: 'Grace',
    body: 'hey',
    createdAt: '2026-08-12T10:00:00.000Z',
    clientMessageId: 'msg_1',
    ...overrides,
  };
}

/** Minutes after the first message, as an ISO string. */
function at(minutes: number): string {
  return new Date(Date.parse('2026-08-12T10:00:00.000Z') + minutes * 60_000).toISOString();
}

describe('groupThread', () => {
  it('marks the day above the first message of it', () => {
    const rows = groupThread([message()], [], NOW);

    expect(rows[0]).toMatchObject({ kind: 'day', label: 'Today' });
    expect(rows[1]).toMatchObject({ kind: 'message' });
  });

  it('marks each day once, however many messages it holds', () => {
    const rows = groupThread(
      [
        message({ id: 'dm_1', createdAt: '2026-08-10T10:00:00.000Z' }),
        message({ id: 'dm_2', createdAt: '2026-08-10T10:01:00.000Z' }),
        message({ id: 'dm_3', createdAt: '2026-08-12T09:00:00.000Z' }),
      ],
      [],
      NOW,
    );

    const labels = rows.filter((row) => row.kind === 'day').map((row) => row.label);
    // The month is spelled out however the reader's locale spells it; what this
    // asserts is that there are two markers and the older one names its date.
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/August/);
    expect(labels[1]).toBe('Today');
  });

  it('gives a run one timestamp, on its last message', () => {
    const rows = groupThread(
      [
        message({ id: 'dm_1', createdAt: at(0) }),
        message({ id: 'dm_2', createdAt: at(1) }),
        message({ id: 'dm_3', createdAt: at(2) }),
      ],
      [],
      NOW,
    );

    const messages = rows.filter((row) => row.kind === 'message');
    expect(messages.map((row) => row.endsRun)).toEqual([false, false, true]);
    // And one gap above the run rather than one above every line.
    expect(messages.map((row) => row.startsRun)).toEqual([true, false, false]);
  });

  it('breaks a run when the other person speaks', () => {
    const rows = groupThread(
      [
        message({ id: 'dm_1', senderId: 'u_them', createdAt: at(0) }),
        message({ id: 'dm_2', senderId: 'u_me', createdAt: at(1) }),
      ],
      [],
      NOW,
    );

    const messages = rows.filter((row) => row.kind === 'message');
    expect(messages.map((row) => row.startsRun)).toEqual([true, true]);
    expect(messages.map((row) => row.endsRun)).toEqual([true, true]);
  });

  it('breaks a run after a long enough pause', () => {
    const rows = groupThread(
      [message({ id: 'dm_1', createdAt: at(0) }), message({ id: 'dm_2', createdAt: at(6) })],
      [],
      NOW,
    );

    // Six minutes is a new thought, not the same breath.
    expect(rows.filter((row) => row.kind === 'message').map((row) => row.startsRun)).toEqual([
      true,
      true,
    ]);
  });

  it('breaks a run across midnight even when the messages are minutes apart', () => {
    // Built from local parts, because "the same day" means the reader's
    // calendar — a fixed UTC pair straddles midnight only in some timezones.
    const justBefore = new Date(2026, 7, 11, 23, 59);
    const justAfter = new Date(2026, 7, 12, 0, 1);

    const rows = groupThread(
      [
        message({ id: 'dm_1', createdAt: justBefore.toISOString() }),
        message({ id: 'dm_2', createdAt: justAfter.toISOString() }),
      ],
      [],
      new Date(2026, 7, 12, 12, 0),
    );

    // Whatever the clock says, a date marker sits between them — and a run that
    // spanned it would put the marker inside itself.
    expect(rows.filter((row) => row.kind === 'day')).toHaveLength(2);
    expect(rows.filter((row) => row.kind === 'message').every((row) => row.startsRun)).toBe(true);
  });

  it('puts unconfirmed sends last', () => {
    const rows = groupThread(
      [message()],
      [{ clientMessageId: 'msg_2', body: 'on my way', status: 'pending' }],
      NOW,
    );

    expect(rows[rows.length - 1]).toMatchObject({ kind: 'pending' });
  });

  it('starts a run for a send that follows a long silence', () => {
    const rows = groupThread(
      [message({ createdAt: '2026-08-12T09:00:00.000Z' })],
      [{ clientMessageId: 'msg_2', body: 'on my way', status: 'pending' }],
      NOW,
    );

    expect(rows[rows.length - 1]).toMatchObject({ kind: 'pending', startsRun: true });
  });

  it('has nothing to arrange in an empty conversation', () => {
    expect(groupThread([], [], NOW)).toEqual([]);
  });
});

describe('dayLabel', () => {
  it('says today and yesterday the way a person would', () => {
    expect(dayLabel('2026-08-12T09:00:00.000Z', NOW)).toBe('Today');
    expect(dayLabel('2026-08-11T09:00:00.000Z', NOW)).toBe('Yesterday');
  });

  it('leaves this year off, and puts another year on', () => {
    // Locale decides the order of the parts; this is about which parts appear.
    expect(dayLabel('2026-08-01T09:00:00.000Z', NOW)).toMatch(/August/);
    expect(dayLabel('2026-08-01T09:00:00.000Z', NOW)).not.toMatch(/2026/);
    expect(dayLabel('2025-08-01T09:00:00.000Z', NOW)).toMatch(/2025/);
  });
});

describe('isEmojiOnly', () => {
  it('recognises a gesture', () => {
    expect(isEmojiOnly('🎉')).toBe(true);
    expect(isEmojiOnly('👋 🙂')).toBe(true);
  });

  it('counts what is on screen, not code points', () => {
    // A flag and a skin-toned wave are several code points each and one thing
    // apiece to a reader.
    expect(isEmojiOnly('🇦🇲👋🏽')).toBe(true);
  });

  it('leaves a sentence alone', () => {
    expect(isEmojiOnly('hi 🎉')).toBe(false);
    expect(isEmojiOnly('100')).toBe(false);
  });

  it('leaves a wall of emoji in its bubble', () => {
    // Past three it is a paragraph, and a paragraph belongs in a bubble.
    expect(isEmojiOnly('🎉🎉🎉🎉')).toBe(false);
  });

  it('is not fooled by whitespace', () => {
    expect(isEmojiOnly('   ')).toBe(false);
    expect(isEmojiOnly('  🎉  ')).toBe(true);
  });

  it('treats punctuation as writing rather than gesture', () => {
    expect(isEmojiOnly('!!!')).toBe(false);
  });
});

describe('insertAt', () => {
  it('drops the emoji at the caret', () => {
    expect(insertAt('see you', '🎉', 3)).toBe('see🎉 you');
  });

  it('replaces what was selected', () => {
    expect(insertAt('see you', '🎉', 0, 3)).toBe('🎉 you');
  });

  it('appends when the caret is past the end', () => {
    // A textarea that has never been focused reports 0, and some browsers
    // report the old length after a programmatic change.
    expect(insertAt('hi', '🎉', 99)).toBe('hi🎉');
  });

  it('survives a backwards range', () => {
    expect(insertAt('see you', '🎉', 3, 0)).toBe('see🎉 you');
  });
});
