/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiLobbyMessage } from '@ai-travel/shared';
import { lobbyService } from '../services/lobby.service';
import { lobbyStore } from './lobby.store';
import * as lobbyChannel from './lobbyChannel';

/**
 * The room's bookkeeping.
 *
 * Most of this file is about one message arriving twice. It comes back as the
 * answer to the POST that created it and again over the realtime channel, in
 * an order nobody controls, and it must end up on screen once either way —
 * with the local guess the sender was shown in the meantime taken away.
 */

function message(overrides: Partial<ApiLobbyMessage> = {}): ApiLobbyMessage {
  return {
    id: 'lm_1',
    userId: 'u_1',
    authorName: 'Ada',
    body: 'Anyone been to Yerevan?',
    createdAt: '2026-08-11T10:00:00.000Z',
    clientMessageId: 'msg_1',
    ...overrides,
  };
}

const state = () => lobbyStore.getSnapshot();

/**
 * A server that echoes the browser's id back, as the real one does.
 *
 * That echo is the whole reconciliation mechanism — a stub returning a fixed
 * id would quietly test nothing.
 */
function serverAccepts(overrides: Partial<ApiLobbyMessage> = {}) {
  return vi
    .spyOn(lobbyService, 'sendMessage')
    .mockImplementation(async (body, clientMessageId) =>
      message({ body, clientMessageId, ...overrides }),
    );
}

beforeEach(() => {
  lobbyStore.reset();
  lobbyStore.close();
});

describe('loading the room', () => {
  it('takes the history oldest first', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockResolvedValue([
      message({ id: 'lm_1', createdAt: '2026-08-11T10:00:00.000Z' }),
      message({ id: 'lm_2', createdAt: '2026-08-11T10:01:00.000Z' }),
    ]);

    await lobbyStore.refresh();

    expect(state().history).toBe('ready');
    expect(state().messages.map((entry) => entry.id)).toEqual(['lm_1', 'lm_2']);
  });

  it('keeps what arrived while the history was still loading', async () => {
    // The reason it is safe to start listening before asking for history: a
    // fetch that replaced rather than merged would lose this message.
    vi.spyOn(lobbyService, 'getMessages').mockImplementation(async () => {
      lobbyStore.receive(message({ id: 'lm_live', createdAt: '2026-08-11T10:05:00.000Z' }));
      return [message({ id: 'lm_1' })];
    });

    await lobbyStore.refresh();

    expect(state().messages.map((entry) => entry.id)).toEqual(['lm_1', 'lm_live']);
  });

  it('says so when the room will not load', async () => {
    vi.spyOn(lobbyService, 'getMessages').mockRejectedValue(new Error('offline'));

    await lobbyStore.refresh();

    expect(state().history).toBe('error');
    expect(state().error).toMatch(/could not load/i);
  });
});

describe('one message, however many times it arrives', () => {
  it('counts a response and a realtime copy as one', async () => {
    const send = serverAccepts();

    await lobbyStore.send('Anyone been to Yerevan?');
    lobbyStore.receive(await send.mock.results[0].value);

    expect(state().messages).toHaveLength(1);
    expect(state().pending).toHaveLength(0);
  });

  it('ends up the same when the realtime copy wins the race', async () => {
    // The server publishes before it writes the response, so this order is the
    // common one rather than the exotic one.
    vi.spyOn(lobbyService, 'sendMessage').mockImplementation(async (body, clientMessageId) => {
      const saved = message({ body, clientMessageId });
      lobbyStore.receive(saved);
      return saved;
    });

    await lobbyStore.send('Anyone been to Yerevan?');

    expect(state().messages).toHaveLength(1);
    expect(state().pending).toHaveLength(0);
  });

  it('slots an older message into place rather than at the end', async () => {
    lobbyStore.receive(message({ id: 'lm_2', createdAt: '2026-08-11T10:02:00.000Z' }));
    lobbyStore.receive(message({ id: 'lm_1', createdAt: '2026-08-11T10:01:00.000Z' }));

    expect(state().messages.map((entry) => entry.id)).toEqual(['lm_1', 'lm_2']);
  });

  it('orders two messages sharing a timestamp the same way for everyone', () => {
    lobbyStore.receive(message({ id: 'lm_b' }));
    lobbyStore.receive(message({ id: 'lm_a' }));

    expect(state().messages.map((entry) => entry.id)).toEqual(['lm_a', 'lm_b']);
  });
});

describe('saying something', () => {
  it('shows it before the server has agreed, then swaps it', async () => {
    let resolve: (value: ApiLobbyMessage) => void = () => undefined;
    let sentId = '';
    vi.spyOn(lobbyService, 'sendMessage').mockImplementation((_body, clientMessageId) => {
      sentId = clientMessageId;

      return new Promise<ApiLobbyMessage>((r) => {
        resolve = r;
      });
    });

    const sending = lobbyStore.send('Anyone been to Yerevan?');

    expect(state().pending).toHaveLength(1);
    expect(state().pending[0].status).toBe('pending');
    expect(state().messages).toHaveLength(0);

    resolve(message({ clientMessageId: sentId }));
    await sending;

    expect(state().pending).toHaveLength(0);
    expect(state().messages).toHaveLength(1);
  });

  it('ignores an empty message', async () => {
    const send = vi.spyOn(lobbyService, 'sendMessage');

    await lobbyStore.send('   ');

    expect(send).not.toHaveBeenCalled();
    expect(state().pending).toHaveLength(0);
  });

  it('trims what it sends', async () => {
    const send = vi.spyOn(lobbyService, 'sendMessage').mockResolvedValue(message());

    await lobbyStore.send('  hello  ');

    expect(send.mock.calls[0][0]).toBe('hello');
  });
});

describe('when a send fails', () => {
  it('keeps the text rather than losing what they typed', async () => {
    vi.spyOn(lobbyService, 'sendMessage').mockRejectedValue(new Error('offline'));

    await lobbyStore.send('Anyone been to Yerevan?');

    expect(state().pending).toEqual([
      expect.objectContaining({ body: 'Anyone been to Yerevan?', status: 'failed' }),
    ]);
    expect(state().error).toMatch(/did not send/i);
  });

  it('retries under the same id, so a lost answer cannot double-post', async () => {
    const send = vi
      .spyOn(lobbyService, 'sendMessage')
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (body, clientMessageId) =>
        message({ body, clientMessageId }),
      );

    await lobbyStore.send('Anyone been to Yerevan?');
    await lobbyStore.retry(state().pending[0].clientMessageId);

    // The first attempt may have been written before the answer was lost. The
    // server keys on this id, so the retry resolves to that row rather than a
    // second one.
    expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]);
    expect(state().messages).toHaveLength(1);
    expect(state().pending).toHaveLength(0);
  });

  it('does nothing when asked to retry something that is gone', async () => {
    const send = vi.spyOn(lobbyService, 'sendMessage');

    await lobbyStore.retry('msg_missing');

    expect(send).not.toHaveBeenCalled();
  });

  it('lets them give up on it', async () => {
    vi.spyOn(lobbyService, 'sendMessage').mockRejectedValue(new Error('offline'));

    await lobbyStore.send('Anyone been to Yerevan?');
    lobbyStore.discard(state().pending[0].clientMessageId);

    expect(state().pending).toHaveLength(0);
    expect(state().error).toBeNull();
  });
});

describe('withdrawing a message', () => {
  it('takes it off screen at once', async () => {
    vi.spyOn(lobbyService, 'deleteMessage').mockResolvedValue(undefined);
    lobbyStore.receive(message());

    await lobbyStore.remove('lm_1');

    expect(state().messages).toHaveLength(0);
  });

  it('puts it back when the server refuses', async () => {
    vi.spyOn(lobbyService, 'deleteMessage').mockRejectedValue(new Error('nope'));
    lobbyStore.receive(message());

    await lobbyStore.remove('lm_1');

    expect(state().messages).toHaveLength(1);
    expect(state().error).toMatch(/could not delete/i);
  });
});

describe('unread', () => {
  it('counts what arrives while the panel is shut', () => {
    lobbyStore.receive(message({ id: 'lm_1' }));
    lobbyStore.receive(message({ id: 'lm_2' }));

    expect(state().unread).toBe(2);
  });

  it('does not count while the panel is open', () => {
    lobbyStore.open();
    lobbyStore.receive(message());

    expect(state().unread).toBe(0);
  });

  it('never counts your own message', async () => {
    vi.spyOn(lobbyService, 'sendMessage').mockResolvedValue(message());

    await lobbyStore.send('Anyone been to Yerevan?');

    // A badge telling someone they have not read what they just typed.
    expect(state().unread).toBe(0);
  });

  it('clears when the panel is opened', () => {
    lobbyStore.receive(message());
    lobbyStore.open();

    expect(state().unread).toBe(0);
  });
});

describe('the panel’s own state', () => {
  it('remembers being left open across a reload', () => {
    lobbyStore.open();
    lobbyStore.reset();

    // `reset` models a sign-out, not a new device — where the panel sits is a
    // property of the screen, not of the account.
    expect(state().isOpen).toBe(true);
  });

  it('toggles', () => {
    lobbyStore.toggle();
    expect(state().isOpen).toBe(true);

    lobbyStore.toggle();
    expect(state().isOpen).toBe(false);
  });

  it('survives storage being unavailable', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    // A private window should cost you the preference, not the room.
    expect(() => lobbyStore.open()).not.toThrow();
    expect(state().isOpen).toBe(true);

    storage.mockRestore();
  });
});

/** A connection that never opens a socket, capturing what the store passes in. */
function fakeChannel() {
  const close = vi.fn(async () => {});
  let captured: Parameters<typeof lobbyChannel.connect>[0] | null = null;

  const spy = vi.spyOn(lobbyChannel, 'connect').mockImplementation(async (handlers) => {
    captured = handlers;
    return { close };
  });

  return { spy, close, handlers: () => captured! };
}

describe('who is in the room', () => {
  it('loads the roster', async () => {
    vi.spyOn(lobbyService, 'getPeople').mockResolvedValue([{ id: 'u_1', name: 'Ada' }]);

    await lobbyStore.refreshPeople();

    expect(state().people).toEqual([{ id: 'u_1', name: 'Ada' }]);
  });

  it('says nothing when the roster will not load', async () => {
    vi.spyOn(lobbyService, 'getPeople').mockRejectedValue(new Error('offline'));

    await lobbyStore.refreshPeople();

    // A failed roster must not put an error banner over a working conversation.
    expect(state().people).toEqual([]);
    expect(state().error).toBeNull();
  });

  it('tells the server who it can see in the presence set', async () => {
    const getPeople = vi.spyOn(lobbyService, 'getPeople').mockResolvedValue([]);
    const channel = fakeChannel();
    lobbyStore.open();
    await lobbyStore.connect();

    channel.handlers().onPresence(['u_1', 'u_2']);
    await vi.waitFor(() => expect(getPeople).toHaveBeenCalled());

    // Without them, someone who connects and says nothing has no name to show:
    // the server's directory is everyone who has *posted*.
    expect(getPeople).toHaveBeenLastCalledWith(['u_1', 'u_2']);
  });
});

describe('reset', () => {
  it('leaves nothing of the last session on screen', async () => {
    vi.spyOn(lobbyService, 'sendMessage').mockRejectedValue(new Error('offline'));
    lobbyStore.receive(message());
    await lobbyStore.send('half-typed');

    lobbyStore.reset();

    expect(state().messages).toHaveLength(0);
    expect(state().pending).toHaveLength(0);
    expect(state().unread).toBe(0);
    expect(state().error).toBeNull();
  });

  it('tells anyone listening', () => {
    const listener = vi.fn();
    const unsubscribe = lobbyStore.subscribe(listener);

    lobbyStore.reset();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('listening', () => {
  it('starts listening before it asks for the history', async () => {
    const channel = fakeChannel();
    const order: string[] = [];

    channel.spy.mockImplementation(async () => {
      order.push('subscribe');
      return { close: channel.close };
    });
    vi.spyOn(lobbyService, 'getMessages').mockImplementation(async () => {
      order.push('backfill');
      return [];
    });

    await lobbyStore.connect();
    await lobbyStore.refresh();

    // The other order loses everything published between the query and the
    // subscription — silently, and without ever reproducing.
    expect(order).toEqual(['subscribe', 'backfill']);
  });

  it('takes a message that arrives by itself', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();

    channel.handlers().onMessage(message({ id: 'lm_live', body: 'live one' }));

    expect(state().messages.map((entry) => entry.body)).toEqual(['live one']);
  });

  it('counts somebody else’s message as unread, and not your own', async () => {
    const channel = fakeChannel();
    lobbyStore.identify('u_me');
    await lobbyStore.connect();

    channel.handlers().onMessage(message({ id: 'lm_1', userId: 'u_other' }));
    channel.handlers().onMessage(message({ id: 'lm_2', userId: 'u_me' }));

    expect(state().unread).toBe(1);
  });

  it('takes a withdrawn message off the screen', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();

    channel.handlers().onMessage(message({ id: 'lm_1' }));
    channel.handlers().onDelete('lm_1');

    expect(state().messages).toHaveLength(0);
  });

  it('reports the connection so the panel can stop claiming to be live', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();

    channel.handlers().onState('unavailable');

    expect(state().connection).toBe('unavailable');
  });

  it('opens one connection however many things ask for it', async () => {
    const channel = fakeChannel();

    await lobbyStore.connect();
    await lobbyStore.connect();

    expect(channel.spy).toHaveBeenCalledTimes(1);

    // The first release must not disconnect the half still watching.
    lobbyStore.disconnect();
    expect(channel.close).not.toHaveBeenCalled();

    lobbyStore.disconnect();
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it('closes a connection that finished opening after everyone let go', async () => {
    const channel = fakeChannel();

    const opening = lobbyStore.connect();
    lobbyStore.disconnect();
    await opening;

    // Otherwise the socket outlives the thing that wanted it, and the reader
    // stays in the room after leaving the page.
    expect(channel.close).toHaveBeenCalled();
  });

  it('drops the connection when the session ends', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();

    lobbyStore.reset();

    // It carries this account's identity; the next person to sign in on this
    // browser must not inherit it.
    expect(channel.close).toHaveBeenCalled();
    expect(state().connection).toBe('idle');
  });
});

describe('presence', () => {
  it('holds whoever is here', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();

    channel.handlers().onPresence(['u_1', 'u_2']);

    expect(state().onlineIds).toEqual(['u_1', 'u_2']);
  });

  it('takes the roster whole rather than merging it', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();

    channel.handlers().onPresence(['u_1', 'u_2']);
    channel.handlers().onPresence(['u_1']);

    // The channel rebuilds from `presence.get()` on every event, so the second
    // call is the truth and not a delta to apply against the first.
    expect(state().onlineIds).toEqual(['u_1']);
  });

  it('fetches names when the room is open and the set changes', async () => {
    const getPeople = vi.spyOn(lobbyService, 'getPeople').mockResolvedValue([]);
    const channel = fakeChannel();
    lobbyStore.open();
    await lobbyStore.connect();

    channel.handlers().onPresence(['u_stranger']);

    await vi.waitFor(() => expect(getPeople).toHaveBeenCalledTimes(1));
  });

  /*
   * The panel mounts on every page for every signed-in reader, and most of
   * them never open it. `useLobbyRoom` is careful not to fetch the
   * conversation until somebody asks to see it; the roster must be equally
   * careful, or connecting puts a query behind every page load anyway.
   */
  it('fetches nothing while the panel is shut', async () => {
    const getPeople = vi.spyOn(lobbyService, 'getPeople').mockResolvedValue([]);
    const channel = fakeChannel();
    await lobbyStore.connect();

    channel.handlers().onPresence(['u_stranger']);

    expect(getPeople).not.toHaveBeenCalled();
  });

  it('does not fetch names again when the same people are still here', async () => {
    const getPeople = vi
      .spyOn(lobbyService, 'getPeople')
      .mockResolvedValue([{ id: 'u_1', name: 'Ada' }]);
    const channel = fakeChannel();
    lobbyStore.open();
    await lobbyStore.connect();
    channel.handlers().onPresence(['u_1']);
    await vi.waitFor(() => expect(getPeople).toHaveBeenCalled());

    getPeople.mockClear();
    // A second tab from the same person is not a change to the set.
    channel.handlers().onPresence(['u_1']);

    expect(getPeople).not.toHaveBeenCalled();
  });

  it('fetches again when somebody leaves, not only when they arrive', async () => {
    const getPeople = vi.spyOn(lobbyService, 'getPeople').mockResolvedValue([]);
    const channel = fakeChannel();
    lobbyStore.open();
    await lobbyStore.connect();
    channel.handlers().onPresence(['u_1']);
    await vi.waitFor(() => expect(getPeople).toHaveBeenCalled());

    getPeople.mockClear();
    channel.handlers().onPresence([]);

    // Somebody who was only ever in the room by being in it must stop being
    // listed when they go — the directory is who has posted plus who is here.
    await vi.waitFor(() => expect(getPeople).toHaveBeenCalledTimes(1));
  });

  it('empties the room when the connection goes', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();
    channel.handlers().onPresence(['u_1', 'u_2']);

    lobbyStore.disconnect();

    // The roster went with the socket; leaving it up would show a room full of
    // people to somebody who is no longer in it.
    expect(state().onlineIds).toEqual([]);
  });

  it('leaves the set when the session ends', async () => {
    const channel = fakeChannel();
    await lobbyStore.connect();
    channel.handlers().onPresence(['u_1']);

    lobbyStore.reset();

    expect(channel.close).toHaveBeenCalled();
    expect(state().onlineIds).toEqual([]);
  });
});
