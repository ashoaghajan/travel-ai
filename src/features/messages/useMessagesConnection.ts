import { useEffect } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { messagesStore } from '../../store/messages.store';

/**
 * Keeps this account's inbox connected for as long as somebody is signed in.
 *
 * On mount rather than on open, deliberately: the collapsed panel still has to
 * show how much has been missed, and a badge that only counts once you look is
 * not a badge. Loading the list and each thread is the half that waits for an
 * actual open — see `useMessagesList`.
 *
 * `identify` before `connect`, and that order is load-bearing: the id names the
 * channel to attach to, so a connection opened without it would have no inbox.
 *
 * Mounted by `AppShell`, which lives inside `RequireAuth`, so there is always
 * an access token by the time the token request goes out.
 */
export function useMessagesConnection(): void {
  const { user, isAuthenticated } = useCurrentUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isAuthenticated) return;

    messagesStore.identify(userId);
    void messagesStore.connect();

    return () => messagesStore.disconnect();
  }, [isAuthenticated, userId]);
}
