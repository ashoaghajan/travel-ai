/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { friendService } from '../../../services/friend.service';
import { friendStore } from '../../../store/friend.store';
import * as useCurrentUserModule from '../../../hooks/useCurrentUser';
import { FriendRequestsToggle } from './FriendRequestsToggle';

/**
 * Friend requests, answerable from wherever the reader happens to be.
 *
 * They used to live only on `/friends`, which meant somebody had to go and
 * look — and nobody goes and looks.
 */

function signedIn(isAuthenticated = true) {
  vi.spyOn(useCurrentUserModule, 'useCurrentUser').mockReturnValue({
    isAuthenticated,
    user: isAuthenticated ? { id: 'u_me', name: 'Ada', email: 'ada@example.com' } : null,
  } as ReturnType<typeof useCurrentUserModule.useCurrentUser>);
}

function waiting(incoming: { id: string; name: string }[]) {
  vi.spyOn(friendService, 'getRequests').mockResolvedValue({
    incoming: incoming.map((person) => ({ ...person, createdAt: '2026-08-12T10:00:00.000Z' })),
    outgoing: [],
  });
}

function renderToggle() {
  return render(
    <MemoryRouter>
      <FriendRequestsToggle />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  friendStore.reset();
  signedIn();
  vi.spyOn(friendService, 'getFriends').mockResolvedValue([]);
  vi.spyOn(friendService, 'getStats').mockResolvedValue({
    friends: 0,
    incoming: 1,
    outgoing: 0,
    totalUsers: 3,
  });
  waiting([{ id: 'u_grace', name: 'Grace' }]);
});

describe('FriendRequestsToggle', () => {
  it('says nothing to a signed-out visitor', () => {
    signedIn(false);

    const { container } = renderToggle();

    expect(container).toBeEmptyDOMElement();
  });

  it('stays out of the way when nothing is waiting', async () => {
    waiting([]);

    const { container } = renderToggle();

    // A permanent third icon would be clutter on every screen for the state
    // most accounts are in most of the time.
    await waitFor(() => expect(friendService.getRequests).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('appears with a count when somebody is waiting', async () => {
    waiting([
      { id: 'u_grace', name: 'Grace' },
      { id: 'u_bo', name: 'Bo' },
    ]);

    renderToggle();

    expect(
      await screen.findByRole('button', { name: 'Friend requests, 2 waiting' }),
    ).toBeInTheDocument();
  });

  it('accepts without going anywhere', async () => {
    const accept = vi.spyOn(friendService, 'acceptFriend').mockResolvedValue('friends');

    const user = userEvent.setup();
    renderToggle();

    await user.click(await screen.findByRole('button', { name: /Friend requests/ }));
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(accept).toHaveBeenCalledWith('u_grace');
  });

  it('declines', async () => {
    const remove = vi.spyOn(friendService, 'removeFriend').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderToggle();

    await user.click(await screen.findByRole('button', { name: /Friend requests/ }));
    await user.click(screen.getByRole('button', { name: 'Decline' }));

    expect(remove).toHaveBeenCalledWith('u_grace');
  });

  it('goes away once the last one is answered', async () => {
    vi.spyOn(friendService, 'acceptFriend').mockResolvedValue('friends');
    vi.spyOn(friendService, 'getRequests')
      .mockResolvedValueOnce({
        incoming: [{ id: 'u_grace', name: 'Grace', createdAt: '2026-08-12T10:00:00.000Z' }],
        outgoing: [],
      })
      .mockResolvedValue({ incoming: [], outgoing: [] });

    const user = userEvent.setup();
    const { container } = renderToggle();

    await user.click(await screen.findByRole('button', { name: /Friend requests/ }));
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    // An empty popover hanging open is a question about nothing.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('offers the page for anything more than yes or no', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(await screen.findByRole('button', { name: /Friend requests/ }));

    expect(screen.getByRole('link', { name: 'See all friends' })).toHaveAttribute(
      'href',
      '/friends',
    );
  });
});
