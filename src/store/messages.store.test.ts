/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConversation, ApiDirectMessage } from '@ai-travel/shared';
import { messagesService } from '../services/messages.service';
import { messagesStore, threadFor } from './messages.store';
import * as messagesChannel from './messagesChannel';

/**
 * The bookkeeping behind a private conversation.
 *
 * Two things run through most of this file. One message arriving twice — as the
 * answer to the POST that created it and again over the realtime channel, in an
 * order nobody controls — must end up on screen once either way, with the local
 * guess the sender was shown in the meantime taken away. And every message,
 * including the reader's own, arrives on one inbox channel, so the thread it
 * belongs to is whichever end of it is not the reader.
 */

const ME = 'u_me';
const THEM = 'u_them';

function message(overrides: Partial<ApiDirectMessage> = {}): ApiDirectMessage {
  return {
    id: 'dm_1',
    senderId: THEM,
    recipientId: ME,
    senderName: 'Grace',
    body: 'Anyone been to Yerevan?',
    createdAt: '2026-08-11T10:00:00.000Z',
    clientMessageId: 'msg_1',
    ...overrides,
  };
}

function conversation(overrides: Partial<ApiConversation> = {}): ApiConversation {
  return { id: THEM, name: 'Grace', lastMessage: null, unread: 0, ...overrides };
}

const state = () => messagesStore.getSnapshot();
const thread = (userId = THEM) => threadFor(state(), userId);

/**
 * A server that echoes the browser's id back, as the real one does.
 *
 * That echo is the whole reconciliation mechanism — a stub returning a fixed id
 * would quietly test nothing.
 */
function serverAccepts(overrides: Partial<ApiDirectMessage> = {}) {
  return vi
    .spyOn(messagesService, 'sendMessage')
    .mockImplementation(async (_userId, body, clientMessageId) =>
      message({ senderId: ME, recipientId: THEM, body, clientMessageId, ...overrides }),
    );
}

/** A connection that never opens a socket, capturing what the store passes in. */
function fakeChannel() {
  const close = vi.fn(async () => {});
  let captured: Parameters<typeof messagesChannel.connect>[1] | null = null;

  const spy = vi.spyOn(messagesChannel, 'connect').mockImplementation(async (_userId, handlers) => {
    captured = handlers;
    return { close };
  });

  return { spy, close, handlers: () => captured! };
}

beforeEach(() => {
  messagesStore.reset();
  messagesStore.close();
  messagesStore.identify(ME);
  vi.spyOn(messagesService, 'markRead').mockResolvedValue(undefined);
});

describe('the people list', () => {
  it('loads everyone you could talk to', async () => {
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([conversation()]);

    await messagesStore.refreshConversations();

    expect(state().directory).toBe('ready');
    expect(state().conversations).toEqual([conversation()]);
  });

  it('remembers what it was filtered by', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([]);

    await messagesStore.refreshConversations('gra');
    await messagesStore.refreshConversations();

    // A refresh triggered by somebody coming online must not silently widen a
    // list the reader has narrowed.
    expect(list.mock.calls).toEqual([['gra'], ['gra']]);
    expect(state().query).toBe('gra');
  });

  it('drops an answer to a search that has been typed past', async () => {
    vi.spyOn(messagesService, 'getConversations').mockImplementation(async (q) => {
      if (q === 'g') {
        // The stale one lands after the newer query has been recorded.
        await Promise.resolve();
        return [conversation({ name: 'stale' })];
      }

      return [conversation({ name: 'Grace' })];
    });

    const stale = messagesStore.refreshConversations('g');
    await messagesStore.refreshConversations('gra');
    await stale;

    expect(state().conversations.map((entry) => entry.name)).toEqual(['Grace']);
  });

  it('says so when the list will not load', async () => {
    vi.spyOn(messagesService, 'getConversations').mockRejectedValue(new Error('offline'));

    await messagesStore.refreshConversations();

    expect(state().directory).toBe('error');
  });
});

describe('opening a conversation', () => {
  it('loads it and marks it read', async () => {
    const read = vi.spyOn(messagesService, 'markRead').mockResolvedValue(undefined);
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([message()]);

    await messagesStore.openThread(THEM);

    expect(state().activeUserId).toBe(THEM);
    expect(thread().history).toBe('ready');
    expect(thread().messages).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(THEM);
  });

  it('clears that person’s badge without waiting for the list', async () => {
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([conversation({ unread: 3 })]);
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([]);
    await messagesStore.refreshConversations();

    await messagesStore.openThread(THEM);

    expect(state().conversations[0].unread).toBe(0);
  });

  it('does not fetch a conversation twice', async () => {
    const get = vi.spyOn(messagesService, 'getThread').mockResolvedValue([]);

    await messagesStore.openThread(THEM);
    messagesStore.closeThread();
    await messagesStore.openThread(THEM);

    // Messages arrive by themselves once the socket is up, so a second
    // backfill would ask for what is already held.
    expect(get).toHaveBeenCalledTimes(1);
    expect(state().activeUserId).toBe(THEM);
  });

  it('tries again after a conversation failed to load', async () => {
    const get = vi
      .spyOn(messagesService, 'getThread')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([message()]);

    await messagesStore.openThread(THEM);
    expect(thread().history).toBe('error');
    expect(state().error).toMatch(/could not load/i);

    await messagesStore.openThread(THEM);

    expect(get).toHaveBeenCalledTimes(2);
    expect(thread().history).toBe('ready');
  });

  it('keeps what arrived while the conversation was still loading', async () => {
    // The reason it is safe to start listening before asking for history: a
    // fetch that replaced rather than merged would lose this message.
    vi.spyOn(messagesService, 'getThread').mockImplementation(async () => {
      messagesStore.receive(message({ id: 'dm_live', createdAt: '2026-08-11T10:05:00.000Z' }));
      return [message({ id: 'dm_1' })];
    });

    await messagesStore.refreshThread(THEM);

    expect(thread().messages.map((entry) => entry.id)).toEqual(['dm_1', 'dm_live']);
  });

  it('backs out to the list', async () => {
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([]);
    await messagesStore.openThread(THEM);

    messagesStore.closeThread();

    expect(state().activeUserId).toBeNull();
  });
});

describe('which conversation a message belongs to', () => {
  it('files what somebody sends you under them', () => {
    messagesStore.receive(message({ senderId: THEM, recipientId: ME }));

    expect(thread(THEM).messages).toHaveLength(1);
  });

  /*
   * The reader's own sends come back on their own inbox channel — that is how
   * their other tabs and devices see what they wrote — so the thread is named
   * by the other end rather than by the sender.
   */
  it('files what you send under the person you sent it to', () => {
    messagesStore.receive(message({ id: 'dm_2', senderId: ME, recipientId: THEM }));

    expect(thread(THEM).messages).toHaveLength(1);
    expect(thread(ME).messages).toHaveLength(0);
  });

  it('leaves another conversation alone', () => {
    messagesStore.receive(message({ id: 'dm_1', senderId: THEM }));
    messagesStore.receive(message({ id: 'dm_2', senderId: 'u_third', clientMessageId: 'msg_2' }));

    expect(thread(THEM).messages).toHaveLength(1);
    expect(thread('u_third').messages).toHaveLength(1);
  });

  it('hands back one empty thread for everybody who has none', () => {
    // Stable identity, or a component asking about a conversation nobody has
    // opened re-renders forever.
    expect(threadFor(state(), 'u_stranger')).toBe(threadFor(state(), 'u_other'));
    expect(threadFor(state(), null).messages).toEqual([]);
  });
});

describe('one message, however many times it arrives', () => {
  it('counts a response and a realtime copy as one', async () => {
    const send = serverAccepts();

    await messagesStore.send(THEM, 'Anyone been to Yerevan?');
    messagesStore.receive(await send.mock.results[0].value);

    expect(thread().messages).toHaveLength(1);
    expect(thread().pending).toHaveLength(0);
  });

  it('ends up the same when the realtime copy wins the race', async () => {
    // The server publishes before it writes the response, so this order is the
    // common one rather than the exotic one.
    vi.spyOn(messagesService, 'sendMessage').mockImplementation(
      async (_userId, body, clientMessageId) => {
        const saved = message({ senderId: ME, recipientId: THEM, body, clientMessageId });
        messagesStore.receive(saved);
        return saved;
      },
    );

    await messagesStore.send(THEM, 'Anyone been to Yerevan?');

    expect(thread().messages).toHaveLength(1);
    expect(thread().pending).toHaveLength(0);
  });

  it('slots an older message into place rather than at the end', () => {
    messagesStore.receive(message({ id: 'dm_2', createdAt: '2026-08-11T10:02:00.000Z' }));
    messagesStore.receive(message({ id: 'dm_1', createdAt: '2026-08-11T10:01:00.000Z' }));

    expect(thread().messages.map((entry) => entry.id)).toEqual(['dm_1', 'dm_2']);
  });

  it('orders two messages sharing a timestamp the same way for everyone', () => {
    messagesStore.receive(message({ id: 'dm_b' }));
    messagesStore.receive(message({ id: 'dm_a' }));

    expect(thread().messages.map((entry) => entry.id)).toEqual(['dm_a', 'dm_b']);
  });
});

describe('saying something', () => {
  it('shows it before the server has agreed, then swaps it', async () => {
    let resolve: (value: ApiDirectMessage) => void = () => undefined;
    let sentId = '';
    vi.spyOn(messagesService, 'sendMessage').mockImplementation(
      (_userId, _body, clientMessageId) => {
        sentId = clientMessageId;

        return new Promise<ApiDirectMessage>((r) => {
          resolve = r;
        });
      },
    );

    const sending = messagesStore.send(THEM, 'Anyone been to Yerevan?');

    expect(thread().pending).toHaveLength(1);
    expect(thread().pending[0].status).toBe('pending');
    expect(thread().messages).toHaveLength(0);

    resolve(message({ senderId: ME, recipientId: THEM, clientMessageId: sentId }));
    await sending;

    expect(thread().pending).toHaveLength(0);
    expect(thread().messages).toHaveLength(1);
  });

  it('sends to the person named, not to whoever is on screen', async () => {
    const send = serverAccepts();

    await messagesStore.send('u_third', 'hello');

    expect(send.mock.calls[0][0]).toBe('u_third');
  });

  it('ignores an empty message', async () => {
    const send = vi.spyOn(messagesService, 'sendMessage');

    await messagesStore.send(THEM, '   ');

    expect(send).not.toHaveBeenCalled();
    expect(thread().pending).toHaveLength(0);
  });

  it('trims what it sends', async () => {
    const send = serverAccepts();

    await messagesStore.send(THEM, '  hello  ');

    expect(send.mock.calls[0][1]).toBe('hello');
  });
});

describe('when a send fails', () => {
  it('keeps the text rather than losing what they typed', async () => {
    vi.spyOn(messagesService, 'sendMessage').mockRejectedValue(new Error('offline'));

    await messagesStore.send(THEM, 'Anyone been to Yerevan?');

    expect(thread().pending).toEqual([
      expect.objectContaining({ body: 'Anyone been to Yerevan?', status: 'failed' }),
    ]);
    expect(state().error).toMatch(/did not send/i);
  });

  it('retries under the same id, so a lost answer cannot double-post', async () => {
    const send = vi
      .spyOn(messagesService, 'sendMessage')
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (_userId, body, clientMessageId) =>
        message({ senderId: ME, recipientId: THEM, body, clientMessageId }),
      );

    await messagesStore.send(THEM, 'Anyone been to Yerevan?');
    await messagesStore.retry(THEM, thread().pending[0].clientMessageId);

    // The first attempt may have been written before the answer was lost. The
    // server keys on this id, so the retry resolves to that row rather than a
    // second one.
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(thread().messages).toHaveLength(1);
    expect(thread().pending).toHaveLength(0);
  });

  it('does nothing when asked to retry something that is gone', async () => {
    const send = vi.spyOn(messagesService, 'sendMessage');

    await messagesStore.retry(THEM, 'msg_missing');

    expect(send).not.toHaveBeenCalled();
  });

  it('lets them give up on it', async () => {
    vi.spyOn(messagesService, 'sendMessage').mockRejectedValue(new Error('offline'));

    await messagesStore.send(THEM, 'Anyone been to Yerevan?');
    messagesStore.discard(THEM, thread().pending[0].clientMessageId);

    expect(thread().pending).toHaveLength(0);
    expect(state().error).toBeNull();
  });
});

describe('withdrawing a message', () => {
  it('takes it off screen at once', async () => {
    vi.spyOn(messagesService, 'deleteMessage').mockResolvedValue(undefined);
    messagesStore.receive(message());

    await messagesStore.remove(THEM, 'dm_1');

    expect(thread().messages).toHaveLength(0);
  });

  it('puts it back when the server refuses', async () => {
    vi.spyOn(messagesService, 'deleteMessage').mockRejectedValue(new Error('nope'));
    messagesStore.receive(message());

    await messagesStore.remove(THEM, 'dm_1');

    expect(thread().messages).toHaveLength(1);
    expect(state().error).toMatch(/could not delete/i);
  });

  it('takes a withdrawal off whichever end it arrives at', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();
    messagesStore.receive(message({ id: 'dm_1', senderId: ME, recipientId: THEM }));

    // The event names both ends because it goes to both of them; this browser
    // is the sender, so the thread it means is the recipient's.
    channel.handlers().onDelete({ id: 'dm_1', senderId: ME, recipientId: THEM });

    expect(thread(THEM).messages).toHaveLength(0);
  });

  it('ignores a withdrawal from a conversation it is not holding', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();

    expect(() =>
      channel.handlers().onDelete({ id: 'dm_9', senderId: 'u_third', recipientId: ME }),
    ).not.toThrow();
    expect(state().threads['u_third']).toBeUndefined();
  });
});

describe('unread', () => {
  beforeEach(async () => {
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([conversation()]);
    await messagesStore.refreshConversations();
  });

  it('counts a message from somebody whose conversation is not on screen', () => {
    messagesStore.receive(message({ senderId: THEM }));

    expect(state().conversations[0].unread).toBe(1);
  });

  it('never counts your own message', () => {
    messagesStore.receive(message({ senderId: ME, recipientId: THEM }));

    // A badge telling someone they have not read what they just typed.
    expect(state().conversations[0].unread).toBe(0);
  });

  it('counts while the panel is shut, even for the conversation last looked at', async () => {
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([]);
    await messagesStore.openThread(THEM);

    messagesStore.receive(message({ senderId: THEM }));

    // Nobody is looking, so this is exactly the case the badge exists for.
    expect(state().conversations[0].unread).toBe(1);
  });

  it('reads what lands in the conversation being looked at', async () => {
    const read = vi.spyOn(messagesService, 'markRead').mockResolvedValue(undefined);
    vi.spyOn(messagesService, 'getThread').mockResolvedValue([]);
    messagesStore.open();
    await messagesStore.openThread(THEM);
    read.mockClear();

    messagesStore.receive(message({ senderId: THEM }));

    expect(state().conversations[0].unread).toBe(0);
    // The cursor moves too, or the badge comes back on the next reload for
    // messages the reader watched arrive.
    expect(read).toHaveBeenCalledWith(THEM);
  });

  it('moves the preview for anything said, in either direction', () => {
    messagesStore.receive(message({ senderId: ME, recipientId: THEM, body: 'on my way' }));

    expect(state().conversations[0].lastMessage).toEqual({
      body: 'on my way',
      createdAt: '2026-08-11T10:00:00.000Z',
      isMine: true,
    });
  });

  it('fetches the list when a stranger writes to you', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([]);
    list.mockClear();

    messagesStore.receive(message({ senderId: 'u_new', recipientId: ME }));

    // Somebody who signed up since the list was loaded, whose message would
    // otherwise arrive from a person with no name.
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
  });

  it('does not fetch the list because of a message you sent to a stranger', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([]);
    list.mockClear();

    messagesStore.receive(message({ id: 'dm_9', senderId: ME, recipientId: 'u_new' }));

    expect(list).not.toHaveBeenCalled();
  });
});

describe('the panel’s own state', () => {
  it('remembers being left open across a reload', () => {
    messagesStore.open();
    messagesStore.reset();

    // `reset` models a sign-out, not a new device — where the panel sits is a
    // property of the screen, not of the account.
    expect(state().isOpen).toBe(true);
  });

  it('toggles', () => {
    messagesStore.toggle();
    expect(state().isOpen).toBe(true);

    messagesStore.toggle();
    expect(state().isOpen).toBe(false);
  });

  it('survives storage being unavailable', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    // A private window should cost you the preference, not your messages.
    expect(() => messagesStore.open()).not.toThrow();
    expect(state().isOpen).toBe(true);

    storage.mockRestore();
  });
});

describe('listening', () => {
  it('listens on this account’s own inbox', async () => {
    const channel = fakeChannel();

    await messagesStore.connect();

    expect(channel.spy.mock.calls[0][0]).toBe(ME);
  });

  it('does not open a socket for nobody', async () => {
    const channel = fakeChannel();
    messagesStore.identify(null);

    await messagesStore.connect();

    // There is no inbox to name. The panel mounts inside `RequireAuth`, so this
    // is the ordering guard rather than a state the app reaches.
    expect(channel.spy).not.toHaveBeenCalled();
  });

  it('takes a message that arrives by itself', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();

    channel.handlers().onMessage(message({ id: 'dm_live', body: 'live one' }));

    expect(thread().messages.map((entry) => entry.body)).toEqual(['live one']);
  });

  it('reports the connection so the panel can stop claiming to be live', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();

    channel.handlers().onState('unavailable');

    expect(state().connection).toBe('unavailable');
  });

  it('opens one connection however many things ask for it', async () => {
    const channel = fakeChannel();

    await messagesStore.connect();
    await messagesStore.connect();

    expect(channel.spy).toHaveBeenCalledTimes(1);

    // The first release must not disconnect the half still watching.
    messagesStore.disconnect();
    expect(channel.close).not.toHaveBeenCalled();

    messagesStore.disconnect();
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it('closes a connection that finished opening after everyone let go', async () => {
    const channel = fakeChannel();

    const opening = messagesStore.connect();
    messagesStore.disconnect();
    await opening;

    // Otherwise the socket outlives the thing that wanted it, and the reader
    // stays online after leaving the page.
    expect(channel.close).toHaveBeenCalled();
  });

  it('drops the connection when the session ends', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();

    messagesStore.reset();

    // It is attached to this account's inbox; the next person to sign in on
    // this browser must not inherit it.
    expect(channel.close).toHaveBeenCalled();
    expect(state().connection).toBe('idle');
  });
});

describe('presence', () => {
  it('holds whoever is here', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();

    channel.handlers().onPresence(['u_1', 'u_2']);

    expect(state().onlineIds).toEqual(['u_1', 'u_2']);
  });

  it('takes the roster whole rather than merging it', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();

    channel.handlers().onPresence(['u_1', 'u_2']);
    channel.handlers().onPresence(['u_1']);

    // The channel rebuilds from `presence.get()` on every event, so the second
    // call is the truth and not a delta to apply against the first.
    expect(state().onlineIds).toEqual(['u_1']);
  });

  it('fetches names when the panel is open and the set changes', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([]);
    const channel = fakeChannel();
    messagesStore.open();
    await messagesStore.connect();

    channel.handlers().onPresence(['u_stranger']);

    // Presence says an id is here; only the list says who that is.
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });

  it('fetches nothing while the panel is shut', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([]);
    const channel = fakeChannel();
    await messagesStore.connect();

    channel.handlers().onPresence(['u_stranger']);

    // The panel mounts on every page for every signed-in reader, and most of
    // them never open it.
    expect(list).not.toHaveBeenCalled();
  });

  it('does not fetch names again when the same people are still here', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([conversation()]);
    const channel = fakeChannel();
    messagesStore.open();
    await messagesStore.connect();
    channel.handlers().onPresence(['u_1']);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());

    list.mockClear();
    // A second tab from the same person is not a change to the set.
    channel.handlers().onPresence(['u_1']);

    expect(list).not.toHaveBeenCalled();
  });

  it('fetches again when somebody leaves, not only when they arrive', async () => {
    const list = vi.spyOn(messagesService, 'getConversations').mockResolvedValue([]);
    const channel = fakeChannel();
    messagesStore.open();
    await messagesStore.connect();
    channel.handlers().onPresence(['u_1']);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());

    list.mockClear();
    channel.handlers().onPresence([]);

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });

  it('empties the set when the connection goes', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();
    channel.handlers().onPresence(['u_1', 'u_2']);

    messagesStore.disconnect();

    expect(state().onlineIds).toEqual([]);
  });

  it('leaves the set when the session ends', async () => {
    const channel = fakeChannel();
    await messagesStore.connect();
    channel.handlers().onPresence(['u_1']);

    messagesStore.reset();

    expect(channel.close).toHaveBeenCalled();
    expect(state().onlineIds).toEqual([]);
  });
});

describe('reset', () => {
  it('leaves nothing of the last session on screen', async () => {
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([conversation()]);
    vi.spyOn(messagesService, 'sendMessage').mockRejectedValue(new Error('offline'));
    await messagesStore.refreshConversations();
    messagesStore.receive(message());
    await messagesStore.send(THEM, 'half-typed');

    messagesStore.reset();

    expect(state().conversations).toEqual([]);
    expect(state().threads).toEqual({});
    expect(state().activeUserId).toBeNull();
    expect(state().error).toBeNull();
  });

  it('forgets who this browser was', async () => {
    const channel = fakeChannel();

    messagesStore.reset();
    await messagesStore.connect();

    // A socket introduced as the previous account is an identity bug, not a
    // stale-data one.
    expect(channel.spy).not.toHaveBeenCalled();
  });

  it('tells anyone listening', () => {
    const listener = vi.fn();
    const unsubscribe = messagesStore.subscribe(listener);

    messagesStore.reset();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
