import { useEffect } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { lobbyStore } from '../../store/lobby.store';

/**
 * Keeps the room connected for as long as somebody is signed in.
 *
 * On mount rather than on open, deliberately: the collapsed panel still has to
 * show how much has been missed, and a badge that only counts once you look is
 * not a badge. The backfill is the half that waits for an actual open — see
 * `useLobbyRoom`.
 *
 * Mounted by `AppShell`, which lives inside `RequireAuth`, so there is always
 * an access token by the time the token request goes out.
 */
export function useLobbyConnection(): void {
  const { user, isAuthenticated } = useCurrentUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isAuthenticated) return;

    lobbyStore.identify(userId);
    void lobbyStore.connect();

    return () => lobbyStore.disconnect();
  }, [isAuthenticated, userId]);
}
