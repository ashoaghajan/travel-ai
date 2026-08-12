import type { DirectMessage, PendingMessage } from '../../store/messages.store';

/**
 * A conversation, arranged for reading.
 *
 * Pure, and in its own file for the reason the other `*.filters.ts` modules
 * are: what counts as one run of messages, and what a day is called, are the
 * parts worth asserting directly — a test that has to render a panel to check
 * that two messages a minute apart share a timestamp is testing the wrong
 * thing.
 */

/**
 * How long a pause has to be before the next message starts a new run.
 *
 * Five minutes, which is roughly the gap at which a reply stops feeling like
 * part of the same breath. Below it the timestamp on each message says nothing
 * the one above it did not.
 */
const RUN_GAP_MS = 5 * 60 * 1000;

/** One row of the thread: a date marker, a confirmed message, or a local one. */
export type ThreadRow =
  | { kind: 'day'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      message: DirectMessage;
      /** First of a run — the one that gets the space above it. */
      startsRun: boolean;
      /** Last of a run — the only one that shows a time. */
      endsRun: boolean;
    }
  | { kind: 'pending'; key: string; entry: PendingMessage; startsRun: boolean };

/** Local midnight, so "the same day" means what the reader's calendar says. */
function dayOf(iso: string): string {
  const at = new Date(iso);

  return `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
}

/**
 * What to call a date in a conversation.
 *
 * "Today" and "Yesterday" because that is what a person would say, and a real
 * date beyond that. The year appears only when it is not this one — writing
 * 2026 on every marker in 2026 is noise, and leaving it off a message from
 * 2025 is a lie by omission.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const today = dayOf(now.toISOString());
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dayOf(iso) === today) return 'Today';
  if (dayOf(iso) === dayOf(yesterday.toISOString())) return 'Yesterday';

  return at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * The thread as rows: date markers, and messages grouped into runs.
 *
 * A run is consecutive messages from one person, close together in time, on one
 * day. Only its last message carries a timestamp and only its first carries the
 * space above it, which is what turns a column of islands into a conversation.
 *
 * Unconfirmed sends are always last and always the reader's own: they are the
 * newest thing said and they have no server time to sort by.
 */
export function groupThread(
  messages: DirectMessage[],
  pending: PendingMessage[] = [],
  now: Date = new Date(),
): ThreadRow[] {
  const rows: ThreadRow[] = [];

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];

    const newDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
    if (newDay) {
      rows.push({
        kind: 'day',
        key: `day-${dayOf(message.createdAt)}`,
        label: dayLabel(message.createdAt, now),
      });
    }

    rows.push({
      kind: 'message',
      key: message.id,
      message,
      startsRun: newDay || !continues(previous, message),
      endsRun: !next || !continues(message, next),
    });
  });

  pending.forEach((entry, index) => {
    const last = messages[messages.length - 1];

    rows.push({
      kind: 'pending',
      key: entry.clientMessageId,
      entry,
      // The first unconfirmed message continues the reader's own run when they
      // are the one who spoke last, and starts one otherwise.
      startsRun: index === 0 && !!last && !continuesFromSelf(last, now),
    });
  });

  return rows;
}

/** Whether `next` belongs to the same run as `previous`. */
function continues(previous: DirectMessage | undefined, next: DirectMessage): boolean {
  if (!previous) return false;
  if (previous.senderId !== next.senderId) return false;
  if (dayOf(previous.createdAt) !== dayOf(next.createdAt)) return false;

  return new Date(next.createdAt).getTime() - new Date(previous.createdAt).getTime() <= RUN_GAP_MS;
}

/**
 * Whether a pending send follows straight on from the last confirmed message.
 *
 * It cannot ask "same sender" — a pending message has no sender id, because it
 * does not exist yet. What it can ask is whether the last thing on screen was
 * recent enough to still be the same breath; if the other person said it, the
 * bubble sits on the other side anyway and the space reads as correct either
 * way.
 */
function continuesFromSelf(last: DirectMessage, now: Date): boolean {
  return now.getTime() - new Date(last.createdAt).getTime() <= RUN_GAP_MS;
}

/**
 * Whether a message is nothing but a few emoji.
 *
 * Which earns it the jumbo treatment every messenger gives it: no bubble, four
 * times the size. Capped at three, because past that it is a wall rather than a
 * gesture and a bubble is the right container again.
 *
 * Counted in grapheme clusters, not code points — a flag, a skin-toned wave and
 * a family are each several code points and exactly one thing on screen.
 */
export function isEmojiOnly(body: string): boolean {
  const text = body.trim();
  if (!text) return false;

  // Anything with a letter or a digit in it is a sentence, whatever else it has.
  if (/[\p{L}\p{N}]/u.test(text)) return false;

  const clusters = [...segment(text)].filter((cluster) => cluster.trim().length > 0);

  return clusters.length > 0 && clusters.length <= 3 && clusters.every(isPictorial);
}

/**
 * Whether one cluster is a picture rather than writing.
 *
 * Two tests, because a flag is neither: regional indicators — the two letters
 * behind 🇦🇲 — are symbols rather than pictographs, so the obvious single check
 * calls every flag a sentence.
 */
function isPictorial(cluster: string): boolean {
  return /\p{Extended_Pictographic}/u.test(cluster) || /^\p{RI}+$/u.test(cluster);
}

/** Grapheme clusters, with a code-point fallback where `Segmenter` is missing. */
function segment(text: string): Iterable<string> {
  if (typeof Intl.Segmenter !== 'function') return [...text];

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  return [...segmenter.segment(text)].map((entry) => entry.segment);
}

/**
 * Puts `insert` into `value` at the caret, replacing any selection.
 *
 * Here rather than in the composer because "where does the emoji land" is a
 * rule with edges — no selection, a selection, a caret past the end — and each
 * of them is one line to assert and three to debug through a rendered popover.
 */
export function insertAt(value: string, insert: string, start: number, end: number = start): string {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));

  return value.slice(0, from) + insert + value.slice(to);
}
