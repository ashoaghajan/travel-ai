import { IconButton } from '../../../components/common/IconButton';
import { ChatBubbleIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { lobbyStore, useLobby } from '../../../store/lobby.store';
import styles from './LobbyToggle.module.css';

/**
 * Opens and closes the lobby, and says how much has been missed.
 *
 * Lives in `PageHeader` beside the account menu, for the reason that file
 * gives for putting the menu there: it is app chrome, in the same corner on
 * every screen, rather than something each page decides about.
 *
 * Renders nothing when nobody is signed in — `PageHeader` is used on the
 * signed-out screens too, and there is no room to open from there.
 */
export function LobbyToggle() {
  const { isAuthenticated, user } = useCurrentUser();
  const { isOpen, unread, onlineIds } = useLobby();

  if (!isAuthenticated) return null;

  /*
   * Somebody other than the reader. Counting yourself would light this for a
   * reader alone in an empty room, which is the one case where "people are
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
      ? `Lobby, ${unread} new`
      : others > 0
        ? `Lobby, ${others} other ${others === 1 ? 'person' : 'people'} here`
        : isOpen
          ? 'Close the lobby'
          : 'Open the lobby';

  return (
    <span className={styles.wrap}>
      <IconButton label={label} aria-expanded={isOpen} onClick={() => lobbyStore.toggle()}>
        <ChatBubbleIcon size={20} />
      </IconButton>

      {badge === 'unread' ? (
        <span className={styles.badge} aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}

      {/* Who is here, while the panel is shut — the reason the connection opens
          on sign-in rather than on expand. A dot rather than a number: the
          useful question when collapsed is whether anyone is around, and the
          count is in the label and in the roster for anyone who wants it. */}
      {badge === 'presence' ? <span className={styles.presence} aria-hidden="true" /> : null}
    </span>
  );
}
