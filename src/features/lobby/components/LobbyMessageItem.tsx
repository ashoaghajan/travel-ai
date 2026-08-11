import { IconButton } from '../../../components/common/IconButton';
import { TrashIcon } from '../../../components/common/icons';
import { cx } from '../../../utils/cx';
import styles from './LobbyMessageItem.module.css';

export type LobbyMessageItemProps = {
  authorName: string;
  body: string;
  /** ISO timestamp, or absent while the message is still on its way. */
  createdAt?: string;
  isOwn: boolean;
  /** Set while the server has not confirmed it yet. */
  pending?: boolean;
  failed?: boolean;
  onDelete?: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
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
 * this panel is barely half that wide. What carries over is the vocabulary —
 * own messages purple and right, everyone else's grey and left.
 *
 * The body is rendered as a text node and nothing here linkifies it. That is a
 * rule rather than an omission: turning what a stranger typed into a clickable
 * link is how a chat feature grows a phishing surface.
 */
export function LobbyMessageItem({
  authorName,
  body,
  createdAt,
  isOwn,
  pending = false,
  failed = false,
  onDelete,
  onRetry,
  onDiscard,
}: LobbyMessageItemProps) {
  return (
    <li className={cx(styles.item, isOwn ? styles.own : styles.other)}>
      {/* Only on other people's messages: repeating your own name back at you
          on every line is noise, and the alignment already says who it was. */}
      {isOwn ? null : <span className={styles.author}>{authorName}</span>}

      <div className={styles.row}>
        <p className={cx(styles.bubble, pending && styles.pending, failed && styles.failed)}>
          {body}
        </p>

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
      ) : (
        <span className={styles.meta}>
          {pending ? 'Sending…' : createdAt ? timeOf(createdAt) : null}
        </span>
      )}
    </li>
  );
}
