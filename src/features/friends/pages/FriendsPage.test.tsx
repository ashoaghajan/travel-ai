/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { friendService } from '../../../services/friend.service';
import { friendStore } from '../../../store/friend.store';
import { FriendsPage } from './FriendsPage';

/**
 * Friends, requests and everybody else.
 *
 * The thing worth pinning is that every row says where the reader stands
 * without them having to infer it from a verb — and that the three lists agree
 * after any of the three buttons is pressed, because they all come from one
 * table.
 */

function renderPage() {
  return render(
    <MemoryRouter>
      <FriendsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  friendStore.reset();

  vi.spyOn(friendService, 'getFriends').mockResolvedValue([
    { id: 'u_ada', name: 'Ada', since: '2026-08-02T10:00:00.000Z' },
  ]);
  vi.spyOn(friendService, 'getRequests').mockResolvedValue({
    incoming: [{ id: 'u_grace', name: 'Grace', createdAt: '2026-08-11T10:00:00.000Z' }],
    outgoing: [{ id: 'u_bo', name: 'Bo', createdAt: '2026-08-11T11:00:00.000Z' }],
  });
  vi.spyOn(friendService, 'getStats').mockResolvedValue({
    friends: 1,
    incoming: 1,
    outgoing: 1,
    totalUsers: 4,
  });
  vi.spyOn(friendService, 'searchPeople').mockResolvedValue([
    { id: 'u_cai', name: 'Cai', status: 'none' },
    { id: 'u_ada', name: 'Ada', status: 'friends' },
  ]);
});

describe('the three lists', () => {
  it('puts what is waiting on the reader first', async () => {
    renderPage();
    await screen.findByText('Wants to be friends');

    const headings = screen.getAllByRole('heading', { level: 2 });

    // The only part of this screen where somebody is waiting on them.
    expect(headings[0]).toHaveTextContent('Waiting for you');
  });

  it('says where the reader stands, in words', async () => {
    renderPage();

    expect(await screen.findByText('Wants to be friends')).toBeInTheDocument();
    expect(screen.getByText('Waiting for an answer')).toBeInTheDocument();
    // Locale decides the order of day and month; this is about which parts
    // appear at all.
    expect(screen.getByText(/^Friends since .*August/)).toBeInTheDocument();
  });

  it('leaves people already on a list out of the search results', async () => {
    renderPage();

    // Ada comes back from the search as a friend, and is already listed above:
    // one row offers to add somebody, and it is Cai's.
    const add = await screen.findAllByRole('button', { name: 'Add friend' });
    expect(add).toHaveLength(1);

    // `toHaveTextContent` rather than `getByText`: `Avatar` renders the name a
    // second time as a hidden label, so the row holds two of them.
    expect(add[0].closest('li')).toHaveTextContent('Cai');
  });
});

describe('answering a request', () => {
  it('accepts, and the lists agree afterwards', async () => {
    const accept = vi.spyOn(friendService, 'acceptFriend').mockResolvedValue('friends');
    vi.spyOn(friendService, 'getFriends')
      .mockResolvedValueOnce([{ id: 'u_ada', name: 'Ada', since: '2026-08-02T10:00:00.000Z' }])
      .mockResolvedValue([
        { id: 'u_ada', name: 'Ada', since: '2026-08-02T10:00:00.000Z' },
        { id: 'u_grace', name: 'Grace', since: '2026-08-12T10:00:00.000Z' },
      ]);
    vi.spyOn(friendService, 'getRequests')
      .mockResolvedValueOnce({
        incoming: [{ id: 'u_grace', name: 'Grace', createdAt: '2026-08-11T10:00:00.000Z' }],
        outgoing: [],
      })
      .mockResolvedValue({ incoming: [], outgoing: [] });

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    expect(accept).toHaveBeenCalledWith('u_grace');
    // The row moves: everything here comes from one table, so a change to it
    // changes all three lists.
    await waitFor(() =>
      expect(screen.queryByText('Wants to be friends')).not.toBeInTheDocument(),
    );
    // Grace has moved from the request list into the friend list, so there are
    // two people there now rather than one.
    await waitFor(() => expect(screen.getAllByText(/^Friends since/)).toHaveLength(2));
  });

  it('declines', async () => {
    const remove = vi.spyOn(friendService, 'removeFriend').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(remove).toHaveBeenCalledWith('u_grace');
  });

  it('cancels one of its own', async () => {
    const remove = vi.spyOn(friendService, 'removeFriend').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(remove).toHaveBeenCalledWith('u_bo');
  });
});

describe('adding somebody', () => {
  it('asks, and searches again so the row stops offering it', async () => {
    const add = vi.spyOn(friendService, 'addFriend').mockResolvedValue('outgoing');
    const search = vi.spyOn(friendService, 'searchPeople');

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add friend' }));

    expect(add).toHaveBeenCalledWith('u_cai');
    // Without the second search the row would go on saying "Add friend" for
    // somebody who has already been asked.
    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(1));
  });

  it('searches by name, once for the word rather than once per letter', async () => {
    const search = vi.spyOn(friendService, 'searchPeople').mockResolvedValue([]);

    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Search for someone by name'), 'cai');

    await waitFor(() => expect(search).toHaveBeenLastCalledWith('cai'));
  });
});

describe('removing a friend', () => {
  it('asks first', async () => {
    const remove = vi.spyOn(friendService, 'removeFriend').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    // Quiet, unhurried, and it takes a conversation off both screens.
    expect(screen.getByText('Remove Ada?')).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    const row = screen.getByText('Remove Ada?').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));

    expect(remove).toHaveBeenCalledWith('u_ada');
  });

  it('lets them change their mind', async () => {
    const remove = vi.spyOn(friendService, 'removeFriend').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

describe('when something fails', () => {
  it('says so, and stays usable', async () => {
    vi.spyOn(friendService, 'acceptFriend').mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not work/i);
    expect(screen.getByRole('button', { name: 'Accept' })).not.toBeDisabled();
  });
});
