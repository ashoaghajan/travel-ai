/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiConversation, ApiDirectMessage } from '@ai-travel/shared';
import { messagesService } from '../../../services/messages.service';
import { shareService } from '../../../services/share.service';
import { messagesStore } from '../../../store/messages.store';
import { tripStore } from '../../../store/trip.store';
import { MessagesPanel } from './MessagesPanel';

/**
 * The panel as it is actually used.
 *
 * `matchMedia` answers false to everything in `src/test/setup.ts`, so these
 * exercise the small-screen branch — the modal dialog, one pane at a time —
 * which is the harder of the two containers and the one with the drill-down
 * worth pinning. The desktop branch differs only in showing both panes at once.
 */

const SELF = { id: 'u_self', name: 'Ada', email: 'ada@example.com' };

vi.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: SELF, isAuthenticated: true, isLoading: false }),
}));

function message(overrides: Partial<ApiDirectMessage> = {}): ApiDirectMessage {
  return {
    id: 'dm_1',
    senderId: 'u_grace',
    recipientId: SELF.id,
    senderName: 'Grace',
    body: 'Anyone been to Yerevan?',
    createdAt: '2026-08-11T10:00:00.000Z',
    clientMessageId: 'msg_1',
    ...overrides,
  };
}

function conversation(overrides: Partial<ApiConversation> = {}): ApiConversation {
  return { id: 'u_grace', name: 'Grace', lastMessage: null, unread: 0, ...overrides };
}

/** Opens the panel and picks somebody, which is two taps on a phone. */
async function openConversationWith(user: ReturnType<typeof userEvent.setup>, name = 'Grace') {
  render(<MessagesPanel />);
  act(() => messagesStore.open());

  await user.click(await screen.findByRole('button', { name: new RegExp(name) }));
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

  messagesStore.reset();
  messagesStore.close();
  messagesStore.identify(SELF.id);

  vi.spyOn(messagesService, 'getConversations').mockResolvedValue([
    conversation(),
    conversation({ id: 'u_bo', name: 'Bo' }),
  ]);
  vi.spyOn(messagesService, 'getThread').mockResolvedValue([message()]);
  vi.spyOn(messagesService, 'markRead').mockResolvedValue(undefined);
});

describe('MessagesPanel', () => {
  it('shows nothing until it is opened', () => {
    render(<MessagesPanel />);

    expect(screen.queryByRole('heading', { name: 'Messages' })).not.toBeInTheDocument();
    expect(messagesService.getConversations).not.toHaveBeenCalled();
  });

  it('loads the people the first time it is opened, and not before', async () => {
    render(<MessagesPanel />);

    act(() => messagesStore.open());

    // Deliberately not on mount: this panel mounts on every page for every
    // signed-in reader, most of whom will never open it.
    expect(await screen.findByRole('button', { name: /Grace/ })).toBeInTheDocument();
    expect(messagesService.getConversations).toHaveBeenCalledTimes(1);
  });

  it('shows what was last said and how much is waiting', async () => {
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([
      conversation({
        unread: 2,
        lastMessage: { body: 'see you', createdAt: '2026-08-11T10:00:00.000Z', isMine: false },
      }),
    ]);

    render(<MessagesPanel />);
    act(() => messagesStore.open());

    const row = await screen.findByRole('button', { name: /Grace/ });
    expect(within(row).getByText('see you')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('says who has never been written to', async () => {
    render(<MessagesPanel />);
    act(() => messagesStore.open());

    const row = await screen.findByRole('button', { name: /Bo/ });
    expect(within(row).getByText('No messages yet')).toBeInTheDocument();
  });

  it('opens one conversation and marks it read', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    expect(messagesService.getThread).toHaveBeenCalledWith('u_grace');
    expect(messagesService.markRead).toHaveBeenCalledWith('u_grace');
    expect(await screen.findByText('Anyone been to Yerevan?')).toBeInTheDocument();
  });

  it('replaces the list with the conversation, and comes back', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    // One pane at this width: the people are gone while a conversation is open.
    expect(screen.queryByRole('list', { name: 'People' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to people' }));

    expect(await screen.findByRole('list', { name: 'People' })).toBeInTheDocument();
    expect(messagesStore.getSnapshot().activeUserId).toBeNull();
  });

  it('names the person and says whether they are here', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    expect(screen.getByRole('heading', { name: 'Grace' })).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('sends what was typed and clears the box', async () => {
    const send = vi
      .spyOn(messagesService, 'sendMessage')
      .mockImplementation(async (_userId, body, clientMessageId) =>
        message({ id: 'dm_2', senderId: SELF.id, recipientId: 'u_grace', body, clientMessageId }),
      );

    const user = userEvent.setup();
    await openConversationWith(user);

    const field = await screen.findByLabelText('Write a message');
    await user.type(field, 'I have!');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(send.mock.calls[0][0]).toBe('u_grace');
    expect(send.mock.calls[0][1]).toBe('I have!');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(await screen.findByText('I have!')).toBeInTheDocument();
  });

  it('sends on Enter, and takes Shift+Enter as a new line', async () => {
    const send = vi.spyOn(messagesService, 'sendMessage').mockResolvedValue(message());

    const user = userEvent.setup();
    await openConversationWith(user);

    const field = await screen.findByLabelText('Write a message');
    await user.type(field, 'first{Shift>}{Enter}{/Shift}second');
    expect(send).not.toHaveBeenCalled();

    await user.type(field, '{Enter}');
    expect(send.mock.calls[0][1]).toBe('first\nsecond');
  });

  it('will not send an empty message', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    await screen.findByLabelText('Write a message');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.type(screen.getByLabelText('Write a message'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('keeps the text and offers a retry when a send fails', async () => {
    vi.spyOn(messagesService, 'sendMessage').mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    await openConversationWith(user);

    await user.type(await screen.findByLabelText('Write a message'), 'I have!{Enter}');

    // The message stays on screen: losing what somebody typed is the failure
    // they would actually resent.
    expect(await screen.findByText('Not sent.')).toBeInTheDocument();
    expect(screen.getByText('I have!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers to delete your own message, and nobody else’s', async () => {
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([
      message({ id: 'dm_1', senderId: 'u_grace', recipientId: SELF.id }),
      message({ id: 'dm_2', senderId: SELF.id, recipientId: 'u_grace', body: 'I have!' }),
    ]);
    const remove = vi.spyOn(messagesService, 'deleteMessage').mockResolvedValue(undefined);

    const user = userEvent.setup();
    await openConversationWith(user);

    const buttons = await screen.findAllByRole('button', { name: 'Delete this message' });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]);
    expect(remove).toHaveBeenCalledWith('dm_2');
  });

  it('says who can read a conversation, before it has started', async () => {
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([]);

    const user = userEvent.setup();
    await openConversationWith(user);

    // A private message has no public witness, so saying plainly who can see it
    // is the cheapest honest thing this screen can do.
    expect(await screen.findByText(/Only the two of you can read it/)).toBeInTheDocument();
  });

  it('gives a run of messages one timestamp, under a single day marker', async () => {
    const now = new Date();
    const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();

    vi.spyOn(messagesService, 'getThread').mockResolvedValue([
      message({ id: 'dm_1', createdAt: minutesAgo(3), body: 'one' }),
      message({ id: 'dm_2', createdAt: minutesAgo(2), body: 'two' }),
      message({ id: 'dm_3', createdAt: minutesAgo(1), body: 'three' }),
    ]);

    const user = userEvent.setup();
    await openConversationWith(user);
    await screen.findByText('three');

    // Three messages, one clock. Stamping each of them is what made this read
    // as a column of islands rather than as somebody talking.
    const list = await screen.findByRole('log');
    expect(within(list).getAllByText(/^\d{1,2}:\d{2}/)).toHaveLength(1);
    expect(within(list).getByText('Today')).toBeInTheDocument();
  });

  it('announces arriving messages to a screen reader', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    // A chat that updates in silence is the case `role="log"` exists for.
    const list = await screen.findByRole('log');
    expect(list).toHaveAttribute('aria-live', 'polite');
  });

  it('puts an emoji where the caret is', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    const field = await screen.findByLabelText('Write a message');
    await user.type(field, 'see you');
    await user.click(screen.getByRole('button', { name: 'Add an emoji' }));
    await user.click(screen.getByRole('button', { name: 'celebrate' }));

    expect(field).toHaveValue('see you🎉');
  });

  it('closes the emoji picker without closing the panel', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);

    await user.click(screen.getByRole('button', { name: 'Add an emoji' }));
    expect(screen.getByRole('button', { name: 'celebrate' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // Escape belongs to the picker while it is open — on a phone the panel is
    // a modal dialog, and letting it through would shut the conversation.
    expect(screen.queryByRole('button', { name: 'celebrate' })).not.toBeInTheDocument();
    expect(messagesStore.getSnapshot().isOpen).toBe(true);
  });

  it('searches for somebody by name', async () => {
    const user = userEvent.setup();
    render(<MessagesPanel />);
    act(() => messagesStore.open());

    await user.type(await screen.findByLabelText('Search for someone'), 'gra');

    // Debounced: one query for the word, not one per letter.
    await waitFor(() => expect(messagesService.getConversations).toHaveBeenLastCalledWith('gra'));
    expect(messagesService.getConversations).toHaveBeenCalledTimes(2);
  });

  it('closes', async () => {
    const user = userEvent.setup();
    render(<MessagesPanel />);
    act(() => messagesStore.open());

    await user.click(await screen.findByRole('button', { name: 'Close messages' }));

    expect(screen.queryByRole('heading', { name: 'Messages' })).not.toBeInTheDocument();
    expect(messagesStore.getSnapshot().isOpen).toBe(false);
  });
});

/**
 * Following the conversation, without dragging anybody along.
 *
 * The panel is on every page, so a message arriving while somebody is reading
 * back through a thread would otherwise yank the view away mid-sentence while
 * they are doing something else entirely.
 */
/**
 * A trip somebody offered, in the thread where they offered it.
 *
 * The card is the message here — the body underneath it ("Shared a trip: …")
 * is what the conversation list previews and what stands in wherever a card
 * cannot go.
 */
describe('a shared trip', () => {
  const SHARE = {
    id: 's_1',
    title: 'Berlin in Early Autumn',
    destination: 'Berlin, Germany',
    startDate: '2026-09-07',
    endDate: '2026-09-11',
    dayCount: 5,
    acceptedAt: null,
    acceptedTripId: null,
    revokedAt: null,
  };

  const SNAPSHOT = {
    title: 'Berlin in Early Autumn',
    destination: 'Berlin, Germany',
    startDate: '2026-09-07',
    endDate: '2026-09-11',
    travellers: 2,
    coverImage: '',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2026-09-07',
        destination: 'Berlin',
        summary: 'Arrive and wander',
        activities: [{ id: 'act_1', time: '10:00', title: 'Tiergarten', category: 'nature' }],
      },
    ],
  };

  function offered() {
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([
      message({ id: 'dm_1', body: 'Shared a trip: Berlin in Early Autumn', share: SHARE }),
    ]);
  }

  it('renders as a card rather than as a sentence', async () => {
    offered();

    const user = userEvent.setup();
    await openConversationWith(user);

    expect(await screen.findByRole('heading', { name: 'Berlin in Early Autumn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to my trips' })).toBeInTheDocument();
  });

  it('opens the itinerary before anybody has to decide', async () => {
    offered();
    vi.spyOn(shareService, 'getShare').mockResolvedValue({ share: SHARE, trip: SNAPSHOT });

    const user = userEvent.setup();
    await openConversationWith(user);
    await user.click(await screen.findByRole('button', { name: 'Preview' }));

    // Accepting without this would be a blind command.
    expect(await screen.findByText('Tiergarten')).toBeInTheDocument();
    expect(screen.getByText(/Bookings do not travel/)).toBeInTheDocument();
  });

  it('makes a copy, and says where it went', async () => {
    offered();
    vi.spyOn(shareService, 'getShare').mockResolvedValue({ share: SHARE, trip: SNAPSHOT });
    const accept = vi.spyOn(shareService, 'acceptShare').mockResolvedValue({ id: 'trip_9' } as never);

    const user = userEvent.setup();
    await openConversationWith(user);
    await user.click(await screen.findByRole('button', { name: 'Add to my trips' }));

    await waitFor(() => expect(accept).toHaveBeenCalled());
    // The itinerary goes up rebuilt by this side: fresh ids, and each
    // photograph resolved against this build.
    expect(accept.mock.calls[0][0]).toBe('s_1');
    expect(accept.mock.calls[0][1]).toMatchObject({ title: 'Berlin in Early Autumn' });

    // The card changes under the finger that pressed it, without waiting for
    // the channel to say so.
    expect(await screen.findByText(/Added to your trips/)).toBeInTheDocument();
  });

  it('files the trip where every other screen reads it', async () => {
    offered();
    vi.spyOn(shareService, 'getShare').mockResolvedValue({ share: SHARE, trip: SNAPSHOT });
    vi.spyOn(shareService, 'acceptShare').mockResolvedValue({
      id: 'trip_9',
      title: 'Berlin in Early Autumn',
    } as never);
    const adopt = vi.spyOn(tripStore, 'adoptTrip');

    const user = userEvent.setup();
    await openConversationWith(user);
    await user.click(await screen.findByRole('button', { name: 'Add to my trips' }));

    /*
     * Accepting writes the row through the shares API, which the trip store
     * never hears about — so without this the trips page, the sidebar and the
     * planner all show a list from before the trip existed until a reload.
     */
    await waitFor(() => expect(adopt).toHaveBeenCalledWith({
      id: 'trip_9',
      title: 'Berlin in Early Autumn',
    }));
  });

  it('lets the sender take an offer back', async () => {
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([
      message({ id: 'dm_1', senderId: SELF.id, recipientId: 'u_grace', share: SHARE }),
    ]);
    const revoke = vi.spyOn(shareService, 'revokeShare').mockResolvedValue(undefined);

    const user = userEvent.setup();
    await openConversationWith(user);
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('s_1'));
    expect(await screen.findByText('You withdrew this trip.')).toBeInTheDocument();
  });

  it('says so when a trip will not open', async () => {
    offered();
    vi.spyOn(shareService, 'getShare').mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    await openConversationWith(user);
    await user.click(await screen.findByRole('button', { name: 'Preview' }));

    expect(await screen.findByText(/could not open that trip/i)).toBeInTheDocument();
  });
});

describe('keeping up with a conversation', () => {
  /** jsdom lays nothing out, so the scroller's geometry has to be stated. */
  function setScrollPosition({ from }: { from: number }) {
    const scroller = document.querySelector('ul[aria-label="Conversation with Grace"]')
      ?.parentElement;
    if (!scroller) throw new Error('no scroller');

    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 600 - from, configurable: true });

    return scroller;
  }

  it('scrolls to the newest when already at the end', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);
    await screen.findByText('Anyone been to Yerevan?');

    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    act(() => messagesStore.receive(message({ id: 'dm_2', body: 'just landed' })));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /new messages/i })).not.toBeInTheDocument();
  });

  it('offers to catch up instead of yanking a reader who has scrolled back', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);
    await screen.findByText('Anyone been to Yerevan?');

    fireEvent.scroll(setScrollPosition({ from: 300 }));

    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    act(() => messagesStore.receive(message({ id: 'dm_2', body: 'just landed' })));

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /new messages/i })).toBeInTheDocument();
  });

  it('goes to the newest when the offer is taken', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);
    await screen.findByText('Anyone been to Yerevan?');

    fireEvent.scroll(setScrollPosition({ from: 300 }));
    act(() => messagesStore.receive(message({ id: 'dm_2', body: 'just landed' })));

    await user.click(screen.getByRole('button', { name: /new messages/i }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /new messages/i })).not.toBeInTheDocument();
  });

  it('drops the offer when the reader scrolls back down themselves', async () => {
    const user = userEvent.setup();
    await openConversationWith(user);
    await screen.findByText('Anyone been to Yerevan?');

    fireEvent.scroll(setScrollPosition({ from: 300 }));
    act(() => messagesStore.receive(message({ id: 'dm_2', body: 'just landed' })));
    expect(screen.getByRole('button', { name: /new messages/i })).toBeInTheDocument();

    fireEvent.scroll(setScrollPosition({ from: 0 }));

    expect(screen.queryByRole('button', { name: /new messages/i })).not.toBeInTheDocument();
  });
});
