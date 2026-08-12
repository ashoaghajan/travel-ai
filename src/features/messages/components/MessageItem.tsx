import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from '../../../components/common/IconButton';
import { TrashIcon } from '../../../components/common/icons';
import { cx } from '../../../utils/cx';
import { isEmojiOnly } from '../message.filters';
import styles from './MessageItem.module.css';

/**
 * How long a send waits before it starts explaining itself.
 *
 * Nothing at first, because most sends are done inside a second and a label
 * that appears and vanishes is worse than no label. Then "Sending…". Then, at
 * fifteen seconds, the sentence that matters: the API sleeps after fifteen idle
 * minutes and takes about a minute to wake, and this panel is the one screen
 * where that is invisible — the other person's messages keep arriving over the
 * socket while this one hangs, which reads as broken for this reader
 * specifically rather than as a server waking up.
 */
const SENDING_AFTER_MS = 4000;
const SLOW_AFTER_MS = 15_000;

type SendingStage = 'fresh' | 'sending' | 'slow';

/**
 * How long this send has been going, in the three stages the copy has words
 * for. Timers rather than a clock: nothing else here re-renders on an interval,
 * and two `setTimeout`s cost less than watching one.
 */
function useSendingStage(pending: boolean): SendingStage {
  const [stage, setStage] = useState<SendingStage>('fresh');

  useEffect(() => {
    if (!pending) {
      setStage('fresh');
      return;
    }

    const sending = setTimeout(() => setStage('sending'), SENDING_AFTER_MS);
    const slow = setTimeout(() => setStage('slow'), SLOW_AFTER_MS);

    return () => {
      clearTimeout(sending);
      clearTimeout(slow);
    };
  }, [pending]);

  return stage;
}

export type MessageItemProps = {
  body: string;
  /** ISO timestamp, or absent while the message is still on its way. */
  createdAt?: string;
  isOwn: boolean;
  /** First of a run — it gets the space above it, the rest of the run does not. */
  startsRun?: boolean;
  /**
   * Whether this message shows its time.
   *
   * Only the last of a run does. Three messages a minute apart do not each need
   * a clock under them, and stamping all three is what makes a thread read as a
   * column of islands rather than as somebody talking.
   */
  showTime?: boolean;
  /** Set while the server has not confirmed it yet. */
  pending?: boolean;
  failed?: boolean;
  onDelete?: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
  /**
   * Rendered instead of the bubble — a shared trip, today.
   *
   * The message keeps its `body` regardless, because that is what the
   * conversation list previews and what stands in wherever a card cannot go.
   * What changes here is only what this row draws.
   */
  children?: ReactNode;
};

/** "14:32" — the room is read as it happens, so the day is noise. */
function timeOf(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * One thing somebody said.
 *
 * The bubble borrows its shape from the planner's, but not its component: that
 * one knows about `'user' | 'ai'` and is sized for a 640px conversation, and
 * this pane is barely half that wide. What carries over is the vocabulary —
 * own messages purple and right, the other person's grey and left.
 *
 * **Nobody's name appears on a bubble.** In a conversation with exactly two
 * people the header already says who the other one is, and the side a message
 * sits on says which of the two wrote it. The public room needed the name on
 * every line; a thread that repeated it would be saying the same thing three
 * times.
 *
 * The body is rendered as a text node and nothing here linkifies it. That is a
 * rule rather than an omission: turning what a stranger typed into a clickable
 * link is how a messaging feature grows a phishing surface.
 */
export function MessageItem({
  body,
  createdAt,
  isOwn,
  startsRun = true,
  showTime = true,
  pending = false,
  failed = false,
  onDelete,
  onRetry,
  onDiscard,
  children,
}: MessageItemProps) {
  const stage = useSendingStage(pending);

  /*
   * A message that is nothing but a gesture is drawn as one: no bubble, four
   * times the size. Every messenger does this, and it is the one piece of
   * decoration that carries actual meaning — 🎉 at body-text size reads as an
   * afterthought rather than as the whole message.
   */
  const jumbo = !failed && isEmojiOnly(body);

  return (
    <li
      className={cx(
        styles.item,
        isOwn ? styles.own : styles.other,
        startsRun && styles.startsRun,
        // A card is the message rather than a remark within it, so it is
        // allowed the width a bubble is deliberately denied. `Boolean` because
        // `cx` takes strings and falsehoods, and a `ReactNode` is neither.
        Boolean(children) && styles.wide,
      )}
    >
      <div className={styles.row}>
        {children ?? (
          <p
            className={cx(
              styles.bubble,
              jumbo && styles.jumbo,
              pending && styles.pending,
              failed && styles.failed,
            )}
          >
            {body}
          </p>
        )}

        {isOwn && onDelete && !pending && !failed ? (
          <IconButton
            label="Delete this message"
            size="md"
            className={styles.delete}
            onClick={onDelete}
          >
            <TrashIcon size={16} />
          </IconButton>
        ) : null}
      </div>

      {failed ? (
        <p className={styles.failure} role="alert">
          <span>Not sent.</span>
          <button type="button" className={styles.link} onClick={onRetry}>
            Try again
          </button>
          <button type="button" className={styles.link} onClick={onDiscard}>
            Discard
          </button>
        </p>
      ) : pending || (showTime && createdAt) ? (
        <span className={cx(styles.meta, stage === 'slow' && styles.slow)} aria-live="polite">
          {/*
            Silent for the first few seconds. A send that completes normally
            should never have said anything about itself.
          */}
          {pending
            ? stage === 'slow'
              ? 'Still sending — the server may be waking up.'
              : stage === 'sending'
                ? 'Sending…'
                : null
            : createdAt
              ? timeOf(createdAt)
              : null}
        </span>
      ) : null}
    </li>
  );
}
