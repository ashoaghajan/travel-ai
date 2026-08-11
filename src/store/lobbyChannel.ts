import type { ApiLobbyMessage } from '@ai-travel/shared';
import { LOBBY_CHANNEL } from '@ai-travel/shared';
import { lobbyService } from '../services/lobby.service';

/**
 * The lobby's realtime connection.
 *
 * The only file in the app that knows Ably exists. Everything above it deals
 * in three callbacks, which is what lets the store be tested without a socket:
 * jsdom has no `WebSocket`, and nothing else in this repo has ever needed one.
 *
 * The SDK is loaded with a dynamic `import`, following `LazyRouteMap`. That
 * keeps it out of the first paint of every page — most readers never open the
 * panel — and it means merely importing this module in a test never opens a
 * connection.
 */

export type LobbyConnectionState = 'connecting' | 'online' | 'offline' | 'unavailable';

export type LobbyChannelHandlers = {
  onMessage: (message: ApiLobbyMessage) => void;
  onDelete: (id: string) => void;
  onState: (state: LobbyConnectionState) => void;
};

export type LobbyConnection = {
  close: () => void;
};

/**
 * How the SDK is obtained. Replaced in tests by a fake, so no socket is ever
 * constructed — and so this module's own wiring can still be exercised.
 */
type RealtimeFactory = (options: unknown) => Promise<AblyRealtimeLike>;

/** Only the parts of the SDK this file uses. */
type AblyRealtimeLike = {
  connection: { on: (listener: (change: { current: string }) => void) => void };
  channels: {
    get: (name: string) => {
      subscribe: (name: string, listener: (message: { data: unknown }) => void) => void;
    };
  };
  close: () => void;
};

let createRealtime: RealtimeFactory = async (options) => {
  const { Realtime } = await import('ably');

  return new Realtime(options as ConstructorParameters<typeof Realtime>[0]) as AblyRealtimeLike;
};

export function setRealtimeFactory(factory: RealtimeFactory): void {
  createRealtime = factory;
}

/** Ably's connection states, as the three the panel actually distinguishes. */
function toState(current: string): LobbyConnectionState {
  if (current === 'connected') return 'online';
  if (current === 'failed' || current === 'suspended') return 'unavailable';
  if (current === 'connecting' || current === 'initialized') return 'connecting';

  return 'offline';
}

/**
 * Opens the connection.
 *
 * Authentication is an `authCallback` rather than an `authUrl`: the token
 * endpoint needs this app's own bearer token, and going through
 * `lobbyService` means the call inherits the single-flight refresh in
 * `http.ts`. An `authUrl` would issue a bare request with no `Authorization`
 * header and start failing fifteen minutes into every session.
 *
 * The callback is also how the connection outlives a token: Ably calls it
 * again shortly before the current one expires.
 */
export async function connect(handlers: LobbyChannelHandlers): Promise<LobbyConnection | null> {
  handlers.onState('connecting');

  let realtime: AblyRealtimeLike;

  try {
    realtime = await createRealtime({
      authCallback: (
        _params: unknown,
        callback: (error: unknown, token: unknown) => void,
      ): void => {
        lobbyService.getRealtimeToken().then(
          (token) => callback(null, token),
          (error: unknown) => callback(error, null),
        );
      },
      // The panel decides when to connect; connecting on construction would
      // race the first token fetch.
      autoConnect: true,
    });
  } catch {
    // The SDK chunk failed to load, or the server has no key. Either way the
    // room still works over HTTP — it just will not update by itself.
    handlers.onState('unavailable');

    return null;
  }

  realtime.connection.on((change) => handlers.onState(toState(change.current)));

  const channel = realtime.channels.get(LOBBY_CHANNEL);

  channel.subscribe('message', (message) => handlers.onMessage(message.data as ApiLobbyMessage));
  channel.subscribe('delete', (message) => handlers.onDelete((message.data as { id: string }).id));

  return {
    close: () => realtime.close(),
  };
}
