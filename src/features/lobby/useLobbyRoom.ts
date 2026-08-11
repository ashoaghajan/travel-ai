import { useEffect } from 'react';
import { lobbyStore, useLobby } from '../../store/lobby.store';

/**
 * Loads the room the first time it is opened.
 *
 * Not on mount: the panel mounts inside `AppShell` for every signed-in reader
 * on every page, and most of them will never open it. Fetching a conversation
 * nobody has asked to see would be a query per page load for nothing.
 *
 * When the realtime channel arrives it connects on mount regardless — the
 * unread badge needs it — and this stays the same: subscribe early, backfill
 * when there is something to show.
 */
export function useLobbyRoom(): void {
  const { isOpen, history } = useLobby();

  useEffect(() => {
    if (!isOpen || history !== 'idle') return;

    void lobbyStore.refresh();
    void lobbyStore.refreshPeople();
  }, [isOpen, history]);
}
