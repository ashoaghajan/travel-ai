/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { messagesService } from '../../../services/messages.service';
import { messagesStore } from '../../../store/messages.store';
import * as messagesChannel from '../../../store/messagesChannel';
import * as useCurrentUserModule from '../../../hooks/useCurrentUser';
import { MessagesToggle } from './MessagesToggle';

/**
 * The one thing the reader can see while the panel is shut.
 *
 * Which is the whole reason the connection opens on sign-in rather than on
 * expand: neither the unread count nor "somebody is around" could exist if the
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
  let handlers: Parameters<typeof messagesChannel.connect>[1] | null = null;
  vi.spyOn(messagesChannel, 'connect').mockImplementation(async (_userId, given) => {
    handlers = given;
    return { close: async () => {} };
  });

  messagesStore.identify('u_me');
  await messagesStore.connect();
  handlers!.onPresence(userIds);
}

/** What the server says is waiting, which is what the badge counts. */
async function waiting(unread: number) {
  vi.spyOn(messagesService, 'getConversations').mockResolvedValue([
    { id: 'u_other', name: 'Bo', lastMessage: null, unread },
  ]);

  await messagesStore.refreshConversations();
}

beforeEach(() => {
  messagesStore.reset();
});

afterEach(() => {
  /*
   * Unmount before touching the store or the mocks. `reset()` notifies its
   * listeners, and a re-render after `useCurrentUser` has been restored runs
   * the real hook — which calls hooks the mock did not, and React rightly
   * refuses. Nothing wrong with the component; the teardown just has an order.
   */
  cleanup();
  messagesStore.reset();
  vi.restoreAllMocks();
});

describe('MessagesToggle', () => {
  it('says nothing to a signed-out visitor', () => {
    vi.spyOn(useCurrentUserModule, 'useCurrentUser').mockReturnValue({
      isAuthenticated: false,
      user: null,
    } as ReturnType<typeof useCurrentUserModule.useCurrentUser>);

    const { container } = render(<MessagesToggle />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reports who else is around while the panel is shut', async () => {
    signedIn();
    await present(['u_me', 'u_other']);

    render(<MessagesToggle />);

    expect(
      screen.getByRole('button', { name: 'Messages, 1 other person online' }),
    ).toBeInTheDocument();
  });

  it('counts people rather than connections', async () => {
    signedIn();
    await present(['u_me', 'u_a', 'u_b']);

    render(<MessagesToggle />);

    expect(
      screen.getByRole('button', { name: 'Messages, 2 other people online' }),
    ).toBeInTheDocument();
  });

  it('does not count the reader as company', async () => {
    signedIn();
    await present(['u_me']);

    render(<MessagesToggle />);

    // Alone is the one case where "people are here" is worth not saying.
    expect(screen.getByRole('button', { name: 'Open messages' })).toBeInTheDocument();
  });

  it('adds up what is waiting across every conversation', async () => {
    signedIn();
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([
      { id: 'u_a', name: 'Bo', lastMessage: null, unread: 2 },
      { id: 'u_b', name: 'Cai', lastMessage: null, unread: 1 },
    ]);
    await messagesStore.refreshConversations();

    render(<MessagesToggle />);

    // Per conversation the badge says which thread to open; here the only
    // useful question is whether anything is waiting at all.
    expect(screen.getByRole('button', { name: 'Messages, 3 new' })).toBeInTheDocument();
  });

  it('gives the corner to the unread count when there is one', async () => {
    signedIn();
    await present(['u_me', 'u_other']);
    await waiting(1);

    render(<MessagesToggle />);

    // Words waiting are actionable; "somebody is around" is not. Stacking both
    // on a 40px button would make neither legible.
    expect(screen.getByRole('button', { name: 'Messages, 1 new' })).toBeInTheDocument();
  });

  it('survives a reload, because the count is the server’s', async () => {
    signedIn();
    await waiting(4);

    render(<MessagesToggle />);

    // The public room counted from mount and forgot on refresh. This is a read
    // cursor in Postgres, so the badge is the same on every device.
    expect(screen.getByRole('button', { name: 'Messages, 4 new' })).toBeInTheDocument();
  });
});
