/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { lobbyStore } from '../../../store/lobby.store';
import * as lobbyChannel from '../../../store/lobbyChannel';
import * as useCurrentUserModule from '../../../hooks/useCurrentUser';
import { LobbyToggle } from './LobbyToggle';

/**
 * The one thing the reader can see while the panel is shut.
 *
 * Which is the whole reason the connection opens on sign-in rather than on
 * expand: neither the unread count nor "somebody is here" could exist if the
 * socket waited for the panel.
 */

function signedIn(id = 'u_me') {
  vi.spyOn(useCurrentUserModule, 'useCurrentUser').mockReturnValue({
    isAuthenticated: true,
    user: { id, name: 'Ada', email: 'ada@example.com' },
  } as ReturnType<typeof useCurrentUserModule.useCurrentUser>);
}

/** Drives the store's presence handler without opening a socket. */
async function present(userIds: string[]) {
  let handlers: Parameters<typeof lobbyChannel.connect>[0] | null = null;
  vi.spyOn(lobbyChannel, 'connect').mockImplementation(async (given) => {
    handlers = given;
    return { close: async () => {} };
  });

  await lobbyStore.connect();
  handlers!.onPresence(userIds);
}

beforeEach(() => {
  lobbyStore.reset();
});

afterEach(() => {
  /*
   * Unmount before touching the store or the mocks. `reset()` notifies its
   * listeners, and a re-render after `useCurrentUser` has been restored runs
   * the real hook — which calls hooks the mock did not, and React rightly
   * refuses. Nothing wrong with the component; the teardown just has an order.
   */
  cleanup();
  lobbyStore.reset();
  vi.restoreAllMocks();
});

describe('LobbyToggle', () => {
  it('says nothing to a signed-out visitor', () => {
    vi.spyOn(useCurrentUserModule, 'useCurrentUser').mockReturnValue({
      isAuthenticated: false,
      user: null,
    } as ReturnType<typeof useCurrentUserModule.useCurrentUser>);

    const { container } = render(<LobbyToggle />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reports who else is here while the panel is shut', async () => {
    signedIn();
    await present(['u_me', 'u_other']);

    render(<LobbyToggle />);

    expect(screen.getByRole('button', { name: 'Lobby, 1 other person here' })).toBeInTheDocument();
  });

  it('counts people rather than connections', async () => {
    signedIn();
    await present(['u_me', 'u_a', 'u_b']);

    render(<LobbyToggle />);

    expect(screen.getByRole('button', { name: 'Lobby, 2 other people here' })).toBeInTheDocument();
  });

  it('does not count the reader as company', async () => {
    signedIn();
    await present(['u_me']);

    render(<LobbyToggle />);

    // Alone in an empty room is the one case where "people are here" is worth
    // not saying.
    expect(screen.getByRole('button', { name: 'Open the lobby' })).toBeInTheDocument();
  });

  it('gives the corner to the unread count when there is one', async () => {
    signedIn();
    await present(['u_me', 'u_other']);
    lobbyStore.receive({
      id: 'lm_1',
      userId: 'u_other',
      authorName: 'Bo',
      body: 'hello',
      createdAt: '2026-08-11T09:00:00.000Z',
      clientMessageId: 'cm_1',
    });

    render(<LobbyToggle />);

    // Words waiting are actionable; "somebody is around" is not. Stacking both
    // on a 40px button would make neither legible.
    expect(screen.getByRole('button', { name: 'Lobby, 1 new' })).toBeInTheDocument();
  });
});
