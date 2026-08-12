import { IconButton } from '../../../components/common/IconButton';
import { ChatBubbleIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { messagesStore, useMessages } from '../../../store/messages.store';
import { countUnread } from '../conversation.filters';
import styles from './MessagesToggle.module.css';

/**
 * Opens and closes the messages panel, and says how much is waiting.
 *
 * Lives in `PageHeader` beside the account menu, for the reason that file
 * gives for putting the menu there: it is app chrome, in the same corner on
 * every screen, rather than something each page decides about.
 *
 * Renders nothing when nobody is signed in — `PageHeader` is used on the
 * signed-out screens too, and there is nothing to open from there.
 */
export function MessagesToggle() {
  const { isAuthenticated, user } = useCurrentUser();
  const { isOpen, conversations, onlineIds } = useMessages();

  if (!isAuthenticated) return null;

  /*
   * Everything waiting, across every conversation.
   *
   * The server's count rather than a tally kept since this tab opened, which
   * is what makes it survive a reload and agree with the reader's phone.
   */
  const unread = countUnread(conversations);

  /*
   * Somebody other than the reader. Counting yourself would light this for a
   * reader with nobody else around, which is the one case where "people are
   * here" is worth not saying.
   */
  const others = onlineIds.filter((id) => id !== user?.id).length;

  /*
   * One mark, not two. The unread count is actionable — words are waiting —
   * so it takes the corner whenever there is one, and the presence dot stands
   * in only when there is nothing to read. Stacking both on a 40px button
   * would make neither legible.
   */
  const badge = unread > 0 ? 'unread' : others > 0 ? 'presence' : 'none';

  const label =
    unread > 0
      ? `Messages, ${unread} new`
      : others > 0
        ? `Messages, ${others} other ${others === 1 ? 'person' : 'people'} online`
        : isOpen
          ? 'Close messages'
          : 'Open messages';

  return (
    <span className={styles.wrap}>
      <IconButton label={label} aria-expanded={isOpen} onClick={() => messagesStore.toggle()}>
        <ChatBubbleIcon size={20} />
      </IconButton>

      {badge === 'unread' ? (
        <span className={styles.badge} aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}

      {/* Who is around, while the panel is shut — the reason the connection
          opens on sign-in rather than on expand. A dot rather than a number:
          the useful question when collapsed is whether anyone is there to
          answer, and the count is in the label for anyone who wants it. */}
      {badge === 'presence' ? <span className={styles.presence} aria-hidden="true" /> : null}
    </span>
  );
}
