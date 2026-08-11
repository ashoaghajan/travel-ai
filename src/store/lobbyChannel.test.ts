/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOBBY_CHANNEL } from '@ai-travel/shared';
import type { ApiLobbyMessage } from '@ai-travel/shared';
import { lobbyService } from '../services/lobby.service';
import { connect, setRealtimeFactory } from './lobbyChannel';
import type { LobbyConnectionState } from './lobbyChannel';

/**
 * The one file that knows Ably exists, exercised through a fake SDK.
 *
 * No socket is ever opened — jsdom has no `WebSocket`, and the point of
 * quarantining the SDK behind this module is that nothing above it needs one
 * either.
 */

type Listener = (message: { data: unknown }) => void;

function fakeSdk() {
  const subscriptions = new Map<string, Listener>();
  let connectionListener: ((change: { current: string }) => void) | undefined;
  const closed = vi.fn();
  let options: Record<string, unknown> = {};

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
          expect(name).toBe(LOBBY_CHANNEL);

          return {
            subscribe: (event: string, listener: Listener) => subscriptions.set(event, listener),
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
    emit: (event: string, data: unknown) => subscriptions.get(event)?.({ data }),
    changeState: (current: string) => connectionListener?.({ current }),
    authCallback: () => options.authCallback as (p: unknown, cb: unknown) => void,
  };
}

/** Typed explicitly so the fake stays honest about the interface it stands in for. */
function makeHandlers() {
  return {
    onMessage: vi.fn<(message: ApiLobbyMessage) => void>(),
    onDelete: vi.fn<(id: string) => void>(),
    onState: vi.fn<(state: LobbyConnectionState) => void>(),
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

    await connect(handlers);

    expect(handlers.onState).toHaveBeenNthCalledWith(1, 'connecting');
  });

  it('hands messages and deletions upward', async () => {
    const sdk = fakeSdk();
    await connect(handlers);

    sdk.emit('message', { id: 'lm_1', body: 'hello' });
    sdk.emit('delete', { id: 'lm_1' });

    expect(handlers.onMessage).toHaveBeenCalledWith({ id: 'lm_1', body: 'hello' });
    expect(handlers.onDelete).toHaveBeenCalledWith('lm_1');
  });

  it.each([
    ['connected', 'online'],
    ['connecting', 'connecting'],
    ['disconnected', 'offline'],
    ['failed', 'unavailable'],
    ['suspended', 'unavailable'],
  ])('reports %s as %s', async (ably, expected) => {
    const sdk = fakeSdk();
    await connect(handlers);

    sdk.changeState(ably);

    expect(handlers.onState).toHaveBeenLastCalledWith(expected);
  });

  it('fetches its token through the app’s own client', async () => {
    const sdk = fakeSdk();
    const token = { clientId: 'u_1', mac: 'x' };
    vi.spyOn(lobbyService, 'getRealtimeToken').mockResolvedValue(token);

    await connect(handlers);

    // Not an `authUrl`: that would send a bare request with no bearer token
    // and start failing fifteen minutes into every session.
    const callback = vi.fn();
    sdk.authCallback()(null, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, token));
  });

  it('passes a token failure back to the SDK rather than throwing', async () => {
    const sdk = fakeSdk();
    const failure = new Error('no key');
    vi.spyOn(lobbyService, 'getRealtimeToken').mockRejectedValue(failure);

    await connect(handlers);

    const callback = vi.fn();
    expect(() => sdk.authCallback()(null, callback)).not.toThrow();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(failure, null));
  });

  it('says the room is not live when the SDK will not load', async () => {
    setRealtimeFactory(async () => {
      throw new Error('chunk failed');
    });

    // The room still works over HTTP; it simply will not update by itself.
    await expect(connect(handlers)).resolves.toBeNull();
    expect(handlers.onState).toHaveBeenLastCalledWith('unavailable');
  });

  it('closes', async () => {
    const sdk = fakeSdk();

    const connection = await connect(handlers);
    connection?.close();

    expect(sdk.closed).toHaveBeenCalled();
  });
});
