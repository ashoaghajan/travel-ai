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
    if (!isOpen) return;

    /*
     * The roster on every open, the conversation only on the first.
     *
     * They are asymmetric because the channel keeps them so. Messages arrive
     * by themselves and the store merges them, so a second backfill would ask
     * for what it already has. Names do not: presence tells us somebody is
     * here, never who they are, and while the panel is shut nothing fetches a
     * name for them — see `arrive`. Reopening is the moment that has to be
     * made good, or a person who joined in the meantime and has never posted
     * is present, dotted, and nameless.
     */
    void lobbyStore.refreshPeople();

    if (history === 'idle') void lobbyStore.refresh();
  }, [isOpen, history]);
}
