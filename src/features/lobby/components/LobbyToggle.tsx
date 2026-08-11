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
  const { isAuthenticated } = useCurrentUser();
  const { isOpen, unread } = useLobby();

  if (!isAuthenticated) return null;

  const label = unread > 0 ? `Lobby, ${unread} new` : isOpen ? 'Close the lobby' : 'Open the lobby';

  return (
    <span className={styles.wrap}>
      <IconButton label={label} aria-expanded={isOpen} onClick={() => lobbyStore.toggle()}>
        <ChatBubbleIcon size={20} />
      </IconButton>

      {unread > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </span>
  );
}
