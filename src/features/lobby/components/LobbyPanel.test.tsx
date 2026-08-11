/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiLobbyMessage } from '@ai-travel/shared';
import { lobbyService } from '../../../services/lobby.service';
import { lobbyStore } from '../../../store/lobby.store';
import { LobbyPanel } from './LobbyPanel';

/**
 * The room as it is actually used.
 *
 * `matchMedia` answers false to everything in `src/test/setup.ts`, so these
 * exercise the phone branch — the modal dialog — which is the harder of the
 * two containers and the one with the browser behaviour worth pinning.
 */

const SELF = { id: 'u_self', name: 'Ada', email: 'ada@example.com' };

vi.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: SELF, isAuthenticated: true, isLoading: false }),
}));

function message(overrides: Partial<ApiLobbyMessage> = {}): ApiLobbyMessage {
  return {
    id: 'lm_1',
    userId: 'u_other',
    authorName: 'Grace',
    body: 'Anyone been to Yerevan?',
    createdAt: '2026-08-11T10:00:00.000Z',
    clientMessageId: 'msg_1',
    ...overrides,
  };
}

beforeEach(() => {
  // jsdom implements none of these three.
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  lobbyStore.reset();
  lobbyStore.close();

  vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([message()]);
  vi.spyOn(lobbyService, 'getPeople').mockResolvedValue([
    { id: 'u_self', name: 'Ada' },
    { id: 'u_other', name: 'Grace' },
  ]);
});

describe('LobbyPanel', () => {
  it('shows nothing until it is opened', () => {
    render(<LobbyPanel />);

    expect(screen.queryByRole('heading', { name: 'Lobby' })).not.toBeInTheDocument();
    expect(lobbyService.getMessages).not.toHaveBeenCalled();
  });

  it('loads the room the first time it is opened, and not before', async () => {
    render(<LobbyPanel />);

    act(() => lobbyStore.open());

    // Deliberately not on mount: this panel mounts on every page for every
    // signed-in reader, most of whom will never open it.
    expect(await screen.findByText('Anyone been to Yerevan?')).toBeInTheDocument();
    expect(lobbyService.getMessages).toHaveBeenCalledTimes(1);
  });

  it('names who said what, and who is here', async () => {
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    // Scoped, because `Avatar` also renders the name as a hidden label and the
    // roster shows it a second time.
    const messages = within(await screen.findByRole('list', { name: 'Messages' }));
    expect(messages.getByText('Grace')).toBeInTheDocument();

    expect(screen.getByText('2 people')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('sends what was typed and clears the box', async () => {
    const send = vi
      .spyOn(lobbyService, 'sendMessage')
      .mockImplementation(async (body, clientMessageId) =>
        message({ id: 'lm_2', userId: SELF.id, authorName: 'Ada', body, clientMessageId }),
      );

    const user = userEvent.setup();
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    const field = await screen.findByLabelText('Write to the lobby');
    await user.type(field, 'I have!');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(send.mock.calls[0][0]).toBe('I have!');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(await screen.findByText('I have!')).toBeInTheDocument();
  });

  it('sends on Enter, and takes Shift+Enter as a new line', async () => {
    const send = vi.spyOn(lobbyService, 'sendMessage').mockResolvedValue(message());

    const user = userEvent.setup();
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    const field = await screen.findByLabelText('Write to the lobby');
    await user.type(field, 'first{Shift>}{Enter}{/Shift}second');
    expect(send).not.toHaveBeenCalled();

    await user.type(field, '{Enter}');
    expect(send.mock.calls[0][0]).toBe('first\nsecond');
  });

  it('will not send an empty message', async () => {
    const user = userEvent.setup();
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    await screen.findByLabelText('Write to the lobby');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.type(screen.getByLabelText('Write to the lobby'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('keeps the text and offers a retry when a send fails', async () => {
    vi.spyOn(lobbyService, 'sendMessage').mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    await user.type(await screen.findByLabelText('Write to the lobby'), 'I have!{Enter}');

    // The message stays on screen: losing what somebody typed is the failure
    // they would actually resent.
    expect(await screen.findByText('Not sent.')).toBeInTheDocument();
    expect(screen.getByText('I have!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers to delete your own message, and nobody else’s', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([
      message({ id: 'lm_1', userId: 'u_other', authorName: 'Grace' }),
      message({ id: 'lm_2', userId: SELF.id, authorName: 'Ada', body: 'I have!' }),
    ]);
    const remove = vi.spyOn(lobbyService, 'deleteMessage').mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    const buttons = await screen.findAllByRole('button', { name: 'Delete this message' });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]);
    expect(remove).toHaveBeenCalledWith('lm_2');
  });

  it('says the room is public, before anyone has spoken', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([]);

    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    // The cheapest privacy control there is, and the one that gets skipped.
    expect(await screen.findByText(/Everyone signed in can see this room/)).toBeInTheDocument();
  });

  it('closes', async () => {
    const user = userEvent.setup();
    render(<LobbyPanel />);
    act(() => lobbyStore.open());

    await user.click(await screen.findByRole('button', { name: 'Close the lobby' }));

    expect(screen.queryByRole('heading', { name: 'Lobby' })).not.toBeInTheDocument();
    expect(lobbyStore.getSnapshot().isOpen).toBe(false);
  });
});

/**
 * Following the conversation, without dragging anybody along.
 *
 * The panel is on every page, so a message arriving while somebody is reading
 * back through the room would otherwise yank the view away mid-sentence while
 * they are doing something else entirely.
 */
describe('keeping up with the room', () => {
  /** jsdom lays nothing out, so the scroller's geometry has to be stated. */
  function setScrollPosition({ from }: { from: number }) {
    const scroller = document.querySelector('[aria-label="Messages"]')?.parentElement;
    if (!scroller) throw new Error('no scroller');

    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 600 - from, configurable: true });

    return scroller;
  }

  it('scrolls to the newest when already at the end', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([message()]);
    render(<LobbyPanel />);
    act(() => lobbyStore.open());
    await screen.findByText('Anyone been to Yerevan?');

    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    act(() => lobbyStore.receive(message({ id: 'lm_2', body: 'just landed' })));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /new messages/i })).not.toBeInTheDocument();
  });

  it('offers to catch up instead of yanking a reader who has scrolled back', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([message()]);
    render(<LobbyPanel />);
    act(() => lobbyStore.open());
    await screen.findByText('Anyone been to Yerevan?');

    const scroller = setScrollPosition({ from: 300 });
    fireEvent.scroll(scroller);

    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    act(() => lobbyStore.receive(message({ id: 'lm_2', body: 'just landed' })));

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /new messages/i })).toBeInTheDocument();
  });

  it('goes to the newest when the offer is taken', async () => {
    const user = userEvent.setup();
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([message()]);
    render(<LobbyPanel />);
    act(() => lobbyStore.open());
    await screen.findByText('Anyone been to Yerevan?');

    fireEvent.scroll(setScrollPosition({ from: 300 }));
    act(() => lobbyStore.receive(message({ id: 'lm_2', body: 'just landed' })));

    await user.click(screen.getByRole('button', { name: /new messages/i }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /new messages/i })).not.toBeInTheDocument();
  });

  it('drops the offer when the reader scrolls back down themselves', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([message()]);
    render(<LobbyPanel />);
    act(() => lobbyStore.open());
    await screen.findByText('Anyone been to Yerevan?');

    fireEvent.scroll(setScrollPosition({ from: 300 }));
    act(() => lobbyStore.receive(message({ id: 'lm_2', body: 'just landed' })));
    expect(screen.getByRole('button', { name: /new messages/i })).toBeInTheDocument();

    fireEvent.scroll(setScrollPosition({ from: 0 }));

    expect(screen.queryByRole('button', { name: /new messages/i })).not.toBeInTheDocument();
  });
});
