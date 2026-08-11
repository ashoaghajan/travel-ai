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
  /** The whole roster, rebuilt — never a delta. See `readPresence`. */
  onPresence: (userIds: string[]) => void;
};

export type LobbyConnection = {
  /**
   * Leaves the presence set, then closes the socket.
   *
   * Leaving first is the point: a close alone lets Ably time the member out
   * minutes later, so a signed-out reader stays "online" to everyone else
   * long after they have gone. See `lobbyStore.reset`.
   */
  close: () => Promise<void>;
};

/**
 * How the SDK is obtained. Replaced in tests by a fake, so no socket is ever
 * constructed — and so this module's own wiring can still be exercised.
 */
type RealtimeFactory = (options: unknown) => Promise<AblyRealtimeLike>;

/** A member of the presence set, as much of one as this file reads. */
export type AblyPresenceMember = { clientId?: string };

/** Only the parts of the SDK this file uses. */
type AblyRealtimeLike = {
  connection: { on: (listener: (change: { current: string }) => void) => void };
  channels: {
    get: (name: string) => {
      subscribe: (name: string, listener: (message: { data: unknown }) => void) => void;
      presence: {
        enter: (data?: unknown) => Promise<void>;
        leave: (data?: unknown) => Promise<void>;
        get: () => Promise<AblyPresenceMember[]>;
        subscribe: (listener: () => void) => void;
      };
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

  /*
   * Presence, in the one order that is correct.
   *
   * Subscribe before entering, for the same reason the store backfills after
   * subscribing: entering first can complete before the listener is attached,
   * and the reader would then be missing from their own roster until somebody
   * else's arrival happened to trigger a rebuild.
   */
  channel.presence.subscribe(() => void readPresence(channel.presence, handlers.onPresence));

  /*
   * Entered with no data at all, deliberately.
   *
   * The `presence` capability lets a client enter carrying anything it likes
   * beside its correctly-pinned `clientId`, so a name taken from here would be
   * whatever that client typed. Names come only from `GET /lobby/people`,
   * joined server-side from `User.name`.
   */
  await channel.presence.enter().catch(() => {
    // A room that cannot say who is here is still a room that works.
  });

  await readPresence(channel.presence, handlers.onPresence);

  return {
    close: async () => {
      // Best-effort: a failed leave still gets timed out by Ably, and there is
      // nothing useful to do with the error on the way out of a session.
      await channel.presence.leave().catch(() => {});
      realtime.close();
    },
  };
}

/**
 * The roster, read whole.
 *
 * Rebuilt from `presence.get()` on **every** event rather than updated from
 * the event itself, which is the rule that makes tabs work: closing one of
 * three tabs fires `leave` while the person is still present in the other two,
 * so applying that delta would show them offline while they are typing.
 * `get()` reads the SDK's own local member map — no round trip.
 *
 * Deduped by `clientId`, which is the user's id: three tabs are three members
 * and one person.
 */
async function readPresence(
  presence: { get: () => Promise<AblyPresenceMember[]> },
  onPresence: (userIds: string[]) => void,
): Promise<void> {
  try {
    const members = await presence.get();

    onPresence([
      ...new Set(
        members
          .map((member) => member.clientId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]);
  } catch {
    // Leave the last known roster up rather than emptying it on a hiccup.
  }
}
