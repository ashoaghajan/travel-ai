/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE_CHANNEL, userChannel } from '@ai-travel/shared';
import type { ApiDirectMessage } from '@ai-travel/shared';
import { messagesService } from '../services/messages.service';
import { connect, setRealtimeFactory } from './messagesChannel';
import type { MessageDeletedEvent, MessagesConnectionState } from './messagesChannel';

/**
 * The one file that knows Ably exists, exercised through a fake SDK.
 *
 * No socket is ever opened — jsdom has no `WebSocket`, and the point of
 * quarantining the SDK behind this module is that nothing above it needs one
 * either.
 */

type Listener = (message: { data: unknown }) => void;

const SELF = 'u_self';

function fakeSdk({ members = [SELF] }: { members?: string[] } = {}) {
  const subscriptions = new Map<string, Listener>();
  let connectionListener: ((change: { current: string }) => void) | undefined;
  let presenceListener: (() => void) | undefined;
  const closed = vi.fn();
  const named: string[] = [];
  let options: Record<string, unknown> = {};

  let present = [...members];

  const presence = {
    enter: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    // Every entry the SDK holds, including the several a person with three
    // tabs open contributes — deduping them is this module's job, not the
    // fake's.
    get: vi.fn(async () => present.map((clientId) => ({ clientId }))),
    subscribe: vi.fn((listener: () => void) => {
      presenceListener = listener;
    }),
  };

  const factory = vi.fn(async (given: unknown) => {
    options = given as Record<string, unknown>;

    return {
      connection: {
        on: (listener: (change: { current: string }) => void) => {
          connectionListener = listener;
        },
      },
      channels: {
        get: vi.fn((name: string) => {
          named.push(name);

          return {
            subscribe: (event: string, listener: Listener) => subscriptions.set(event, listener),
            presence,
          };
        }),
      },
      close: closed,
    };
  });

  setRealtimeFactory(factory);

  return {
    factory,
    closed,
    presence,
    /** Which channels were attached to, in order. */
    named,
    emit: (event: string, data: unknown) => subscriptions.get(event)?.({ data }),
    changeState: (current: string) => connectionListener?.({ current }),
    authCallback: () => options.authCallback as (p: unknown, cb: unknown) => void,
    /** What Ably does on any arrival or departure: fire, having already updated. */
    presenceChanges: (next: string[]) => {
      present = next;
      presenceListener?.();
    },
  };
}

/** Typed explicitly so the fake stays honest about the interface it stands in for. */
function makeHandlers() {
  return {
    onMessage: vi.fn<(message: ApiDirectMessage) => void>(),
    onDelete: vi.fn<(event: MessageDeletedEvent) => void>(),
    onState: vi.fn<(state: MessagesConnectionState) => void>(),
    onPresence: vi.fn<(userIds: string[]) => void>(),
  };
}

let handlers: ReturnType<typeof makeHandlers>;

beforeEach(() => {
  handlers = makeHandlers();
});

afterEach(() => {
  // Put the real dynamic import back so a later file does not inherit the fake.
  setRealtimeFactory(async () => {
    throw new Error('not stubbed');
  });
});

describe('connect', () => {
  it('reports that it is trying before anything else happens', async () => {
    fakeSdk();

    await connect(SELF, handlers);

    expect(handlers.onState).toHaveBeenNthCalledWith(1, 'connecting');
  });

  /*
   * The split the whole design rests on: an inbox nobody else may attach to,
   * and one shared channel carrying who is online.
   */
  it('attaches to this account’s own inbox and to the shared presence channel', async () => {
    const sdk = fakeSdk();

    await connect(SELF, handlers);

    expect(sdk.named).toEqual([userChannel(SELF), PRESENCE_CHANNEL]);
  });

  it('hands messages upward', async () => {
    const sdk = fakeSdk();
    await connect(SELF, handlers);

    sdk.emit('message', { id: 'dm_1', body: 'hello' });

    expect(handlers.onMessage).toHaveBeenCalledWith({ id: 'dm_1', body: 'hello' });
  });

  /*
   * A withdrawal names both ends rather than "the other person": the same
   * event goes to both of them, and each has a different answer to which
   * thread it came out of.
   */
  it('hands a withdrawal upward with both ends of it', async () => {
    const sdk = fakeSdk();
    await connect(SELF, handlers);

    sdk.emit('delete', { id: 'dm_1', senderId: 'u_1', recipientId: SELF });

    expect(handlers.onDelete).toHaveBeenCalledWith({
      id: 'dm_1',
      senderId: 'u_1',
      recipientId: SELF,
    });
  });

  it.each([
    ['connected', 'online'],
    ['connecting', 'connecting'],
    ['disconnected', 'offline'],
    ['failed', 'unavailable'],
    ['suspended', 'unavailable'],
  ])('reports %s as %s', async (ably, expected) => {
    const sdk = fakeSdk();
    await connect(SELF, handlers);

    sdk.changeState(ably);

    expect(handlers.onState).toHaveBeenLastCalledWith(expected);
  });

  it('fetches its token through the app’s own client', async () => {
    const sdk = fakeSdk();
    const token = { clientId: SELF, mac: 'x' };
    vi.spyOn(messagesService, 'getRealtimeToken').mockResolvedValue(token);

    await connect(SELF, handlers);

    // Not an `authUrl`: that would send a bare request with no bearer token
    // and start failing fifteen minutes into every session.
    const callback = vi.fn();
    sdk.authCallback()(null, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, token));
  });

  it('passes a token failure back to the SDK rather than throwing', async () => {
    const sdk = fakeSdk();
    const failure = new Error('no key');
    vi.spyOn(messagesService, 'getRealtimeToken').mockRejectedValue(failure);

    await connect(SELF, handlers);

    const callback = vi.fn();
    expect(() => sdk.authCallback()(null, callback)).not.toThrow();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(failure, null));
  });

  it('says messages are not live when the SDK will not load', async () => {
    setRealtimeFactory(async () => {
      throw new Error('chunk failed');
    });

    // Messages still send and persist over HTTP; they simply do not arrive by
    // themselves.
    await expect(connect(SELF, handlers)).resolves.toBeNull();
    expect(handlers.onState).toHaveBeenLastCalledWith('unavailable');
  });

  it('closes', async () => {
    const sdk = fakeSdk();

    const connection = await connect(SELF, handlers);
    await connection?.close();

    expect(sdk.closed).toHaveBeenCalled();
  });
});

describe('presence', () => {
  it('enters the set and reports who is in it', async () => {
    const sdk = fakeSdk({ members: [SELF, 'u_other'] });

    await connect(SELF, handlers);

    expect(sdk.presence.enter).toHaveBeenCalled();
    expect(handlers.onPresence).toHaveBeenLastCalledWith([SELF, 'u_other']);
  });

  it('enters carrying nothing', async () => {
    const sdk = fakeSdk();

    await connect(SELF, handlers);

    // The `presence` capability lets a client enter with arbitrary data, so a
    // name carried here would be whatever that client felt like. Names come
    // from the server-side join and nowhere else.
    expect(sdk.presence.enter).toHaveBeenCalledWith();
  });

  it('subscribes before entering', async () => {
    const sdk = fakeSdk();

    await connect(SELF, handlers);

    // The other order can enter before the listener is attached, leaving the
    // reader out of their own roster until somebody else happens to arrive.
    expect(sdk.presence.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.presence.enter.mock.invocationCallOrder[0],
    );
  });

  it('rebuilds the whole roster on any presence event', async () => {
    const sdk = fakeSdk({ members: [SELF] });
    await connect(SELF, handlers);

    sdk.presenceChanges([SELF, 'u_new']);

    await vi.waitFor(() => expect(handlers.onPresence).toHaveBeenLastCalledWith([SELF, 'u_new']));
  });

  /*
   * The rule the whole design turns on. Three tabs are three members and one
   * person, so a `leave` from one of them is not a departure — and applying
   * the event instead of re-reading the set would show somebody offline while
   * they are still typing.
   */
  it('counts a person once however many tabs they have open', async () => {
    fakeSdk({ members: [SELF, 'u_other', 'u_other', 'u_other'] });

    await connect(SELF, handlers);

    expect(handlers.onPresence).toHaveBeenLastCalledWith([SELF, 'u_other']);
  });

  it('keeps someone online when one of their tabs leaves', async () => {
    const sdk = fakeSdk({ members: [SELF, 'u_other', 'u_other'] });
    await connect(SELF, handlers);

    // One tab gone, one still there — which is what `get()` reports.
    sdk.presenceChanges([SELF, 'u_other']);

    await vi.waitFor(() => expect(handlers.onPresence).toHaveBeenLastCalledWith([SELF, 'u_other']));
  });

  it('leaves the set before closing the socket', async () => {
    const sdk = fakeSdk();

    const connection = await connect(SELF, handlers);
    await connection?.close();

    // Closing alone leaves the member to time out minutes later, so a reader
    // who signed out would go on showing as online to everybody else.
    expect(sdk.presence.leave.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.closed.mock.invocationCallOrder[0],
    );
  });

  it('still closes when leaving fails', async () => {
    const sdk = fakeSdk();
    sdk.presence.leave.mockRejectedValueOnce(new Error('gone'));

    const connection = await connect(SELF, handlers);

    await expect(connection?.close()).resolves.toBeUndefined();
    expect(sdk.closed).toHaveBeenCalled();
  });

  it('keeps the last roster when the set cannot be read', async () => {
    const sdk = fakeSdk({ members: [SELF, 'u_other'] });
    await connect(SELF, handlers);

    handlers.onPresence.mockClear();
    sdk.presence.get.mockRejectedValueOnce(new Error('offline'));
    sdk.presenceChanges([SELF]);

    // Emptying the list on a hiccup would read as everyone leaving at once.
    await vi.waitFor(() => expect(sdk.presence.get).toHaveBeenCalled());
    expect(handlers.onPresence).not.toHaveBeenCalled();
  });

  it('still delivers messages when entering the set fails', async () => {
    const sdk = fakeSdk();
    sdk.presence.enter.mockRejectedValueOnce(new Error('no capability'));

    await expect(connect(SELF, handlers)).resolves.not.toBeNull();
  });
});
