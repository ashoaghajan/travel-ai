import type { ApiDirectMessage } from '@ai-travel/shared';
import { PRESENCE_CHANNEL, userChannel } from '@ai-travel/shared';
import { messagesService } from '../services/messages.service';

/**
 * The realtime connection for direct messages.
 *
 * The only file in the app that knows Ably exists. Everything above it deals in
 * four callbacks, which is what lets the store be tested without a socket:
 * jsdom has no `WebSocket`, and nothing else in this repo has ever needed one.
 *
 * **Two channels, replacing the public room's single one.** They are split
 * because they answer different questions and have different audiences:
 *
 * - **`user:<self>`** is this account's inbox. Every message either way lands
 *   here — including the reader's own sends, so their other tabs and devices
 *   see what they just wrote. Nobody else may attach to it: the token names
 *   this id and no other, so a private conversation is private at the
 *   transport rather than by a filter somewhere in a query.
 * - **`presence:global`** carries who is online, because the people list shows
 *   everyone's status and not only the status of people already talked to.
 *
 * The SDK is loaded with a dynamic `import`, following `LazyRouteMap`. That
 * keeps it out of the first paint of every page — most readers never open the
 * panel — and it means merely importing this module in a test never opens a
 * connection.
 */

export type MessagesConnectionState = 'connecting' | 'online' | 'offline' | 'unavailable';

/**
 * A withdrawal, as it arrives.
 *
 * Both ends rather than "the other person", because the same event goes to
 * both of them and each has a different answer to that. A client works out
 * which of its threads is meant by taking whichever id is not its own.
 */
export type MessageDeletedEvent = {
  id: string;
  senderId: string;
  recipientId: string;
};

export type MessagesChannelHandlers = {
  onMessage: (message: ApiDirectMessage) => void;
  /**
   * A shared trip changed state — taken up, or withdrawn.
   *
   * The whole message, not a patch: it is small, it is the shape the store
   * already reconciles by id, and a second shape would be a second thing that
   * can disagree with the first. Separate from `onMessage` because nothing new
   * was *said* — a badge for a card changing colour would be a lie.
   */
  onShare: (message: ApiDirectMessage) => void;
  onDelete: (event: MessageDeletedEvent) => void;
  onState: (state: MessagesConnectionState) => void;
  /** The whole roster, rebuilt — never a delta. See `readPresence`. */
  onPresence: (userIds: string[]) => void;
};

export type MessagesConnection = {
  /**
   * Leaves the presence set, then closes the socket.
   *
   * Leaving first is the point: a close alone lets Ably time the member out
   * minutes later, so a signed-out reader stays "online" to everyone else long
   * after they have gone. See `messagesStore.reset`.
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

type AblyPresenceLike = {
  enter: (data?: unknown) => Promise<void>;
  leave: (data?: unknown) => Promise<void>;
  get: () => Promise<AblyPresenceMember[]>;
  subscribe: (listener: () => void) => void;
};

/** Only the parts of the SDK this file uses. */
type AblyRealtimeLike = {
  connection: { on: (listener: (change: { current: string }) => void) => void };
  channels: {
    get: (name: string) => {
      subscribe: (name: string, listener: (message: { data: unknown }) => void) => void;
      presence: AblyPresenceLike;
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

/** Ably's connection states, as the four the panel actually distinguishes. */
function toState(current: string): MessagesConnectionState {
  if (current === 'connected') return 'online';
  if (current === 'failed' || current === 'suspended') return 'unavailable';
  if (current === 'connecting' || current === 'initialized') return 'connecting';

  return 'offline';
}

/**
 * Opens the connection.
 *
 * `userId` names the inbox to attach to. It is passed in rather than read out
 * of the token: the token is opaque here, and the store already knows who is
 * signed in. If the two ever disagreed, Ably would refuse the attach — the
 * capability is pinned server-side — which is the failure worth having.
 *
 * Authentication is an `authCallback` rather than an `authUrl`: the token
 * endpoint needs this app's own bearer token, and going through
 * `messagesService` means the call inherits the single-flight refresh in
 * `http.ts`. An `authUrl` would issue a bare request with no `Authorization`
 * header and start failing fifteen minutes into every session.
 *
 * The callback is also how the connection outlives a token: Ably calls it
 * again shortly before the current one expires.
 */
export async function connect(
  userId: string,
  handlers: MessagesChannelHandlers,
): Promise<MessagesConnection | null> {
  handlers.onState('connecting');

  let realtime: AblyRealtimeLike;

  try {
    realtime = await createRealtime({
      authCallback: (
        _params: unknown,
        callback: (error: unknown, token: unknown) => void,
      ): void => {
        messagesService.getRealtimeToken().then(
          (token) => callback(null, token),
          (error: unknown) => callback(error, null),
        );
      },
      autoConnect: true,
    });
  } catch {
    // The SDK chunk failed to load, or the server has no key. Either way
    // messages still work over HTTP — they simply will not arrive by
    // themselves.
    handlers.onState('unavailable');

    return null;
  }

  realtime.connection.on((change) => handlers.onState(toState(change.current)));

  const inbox = realtime.channels.get(userChannel(userId));

  inbox.subscribe('message', (message) => handlers.onMessage(message.data as ApiDirectMessage));
  inbox.subscribe('delete', (message) => handlers.onDelete(message.data as MessageDeletedEvent));
  inbox.subscribe('share', (message) => handlers.onShare(message.data as ApiDirectMessage));

  const presence = realtime.channels.get(PRESENCE_CHANNEL).presence;

  /*
   * Presence, in the one order that is correct.
   *
   * Subscribe before entering, for the same reason the store backfills after
   * subscribing: entering first can complete before the listener is attached,
   * and the reader would then be missing from their own roster until somebody
   * else's arrival happened to trigger a rebuild.
   */
  presence.subscribe(() => void readPresence(presence, handlers.onPresence));

  /*
   * Entered with no data at all, deliberately.
   *
   * The `presence` capability lets a client enter carrying anything it likes
   * beside its correctly-pinned `clientId`, so a name taken from here would be
   * whatever that client typed. Names come only from
   * `GET /messages/conversations`, joined server-side from `User.name`.
   */
  await presence.enter().catch(() => {
    // A list that cannot say who is here is still a list you can write to.
  });

  await readPresence(presence, handlers.onPresence);

  return {
    close: async () => {
      // Best-effort: a failed leave still gets timed out by Ably, and there is
      // nothing useful to do with the error on the way out of a session.
      await presence.leave().catch(() => {});
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
