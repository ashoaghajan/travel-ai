import { useEffect } from 'react';
import { messagesStore, useMessages } from '../../store/messages.store';

/**
 * Loads the people list the moment somebody looks, and not before.
 *
 * Not on mount: the panel mounts inside `AppShell` for every signed-in reader
 * on every page, and most of them will never open it. Fetching a list nobody
 * has asked to see would be a query per page load for nothing.
 *
 * On every open rather than only the first, unlike a thread. The two are
 * asymmetric because the channel keeps them so: messages arrive by themselves
 * and the store merges them, so a second backfill would ask for what it already
 * has. Names do not arrive that way — presence says an id is here, never who it
 * is — so reopening is the moment to make good on anyone who has signed up,
 * come online, or written since.
 */
export function useMessagesList(): void {
  const { isOpen } = useMessages();

  useEffect(() => {
    if (!isOpen) return;

    void messagesStore.refreshConversations();
  }, [isOpen]);
}
