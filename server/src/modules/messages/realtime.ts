import { PRESENCE_CHANNEL, userChannel } from '@ai-travel/shared';
import type { ApiDirectMessage } from '@ai-travel/shared';
import Ably from 'ably';
import { env } from '../../env';

/**
 * The realtime provider for direct messages.
 *
 * The only file that knows Ably exists. Two jobs, done two different ways on
 * purpose:
 *
 * **Signing a token** goes through the SDK. The signature is an HMAC over an
 * exact canonical string, and a hand-rolled version fails in a way nothing
 * catches until a browser refuses to connect. It is also offline — no request
 * leaves this process — which keeps the token endpoint fast on a cold instance.
 *
 * **Publishing** is a plain `fetch` to one REST URL, like every other provider
 * in this codebase, so it stubs at `fetch` in tests rather than needing the
 * SDK's own HTTP layer mocked.
 */

const REST_ORIGIN = 'https://rest.ably.io';

/** An hour, deliberately unrelated to the 15-minute access token. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * What goes on the wire when a message is sent or withdrawn.
 *
 * A withdrawal carries both ends rather than "the other person", because the
 * same event goes to both of them and each has a different answer to that.
 * Each client works out which of its threads is meant by taking whichever id
 * is not its own.
 */
export type MessageRealtimeEvent =
  | { name: 'message'; data: ApiDirectMessage }
  | { name: 'delete'; data: { id: string; senderId: string; recipientId: string } }
  /**
   * A shared trip changed state — taken up, or withdrawn.
   *
   * Carries the whole message rather than a patch: it is small, it is the
   * shape both clients already reconcile by id, and a second shape would be a
   * second thing that can disagree with the first.
   */
  | { name: 'share'; data: ApiDirectMessage }
  /**
   * Somebody asked, answered or withdrew a friend request.
   *
   * Carries nothing: the client refetches. There is no shape here that could
   * go stale or disagree with the table, and a friendship has no fields worth
   * putting on a wire — it exists or it does not.
   */
  | { name: 'friend'; data: Record<string, never> };

let client: Ably.Rest | null = null;

/** Whether the realtime half is switched on at all. */
export function isConfigured(): boolean {
  return Boolean(env().ABLY_API_KEY);
}

function rest(): Ably.Rest {
  const key = env().ABLY_API_KEY;
  if (!key) throw new Error('ABLY_API_KEY is not set');

  client ??= new Ably.Rest({ key });

  return client;
}

/** Test seam — the client caches the key it was built with. */
export function resetRealtimeClient(): void {
  client = null;
}

/**
 * What a browser is allowed to do with the token this server signs.
 *
 * Two channels, and the split is the whole design:
 *
 * - **`presence:global`** carries who is online. Everybody attaches to it,
 *   because the people list shows everyone's status rather than only the
 *   status of people you already have a thread with.
 * - **`user:<caller>`** is this account's private inbox, and it is pinned to
 *   the caller's own id. A token cannot name somebody else's, so one browser
 *   physically cannot listen to another person's messages. That is what makes
 *   a private conversation private *at the transport*, not merely by
 *   convention in a query.
 *
 * **`publish` is absent from both.** Every message goes through
 * `POST /api/messages/with/:userId`, where it is validated, rate-limited and
 * written down before anyone sees it. Without that omission a client could put
 * anything on a channel under its own name and every other client would have
 * to re-validate what it received.
 */
export function capabilityFor(userId: string): Record<string, string[]> {
  return {
    [PRESENCE_CHANNEL]: ['subscribe', 'presence'],
    [userChannel(userId)]: ['subscribe'],
  };
}

/**
 * A signed token request for one account.
 *
 * `clientId` is set here and enforced by Ably, so a browser cannot join
 * presence as somebody else. That is the whole basis on which the online list
 * can be believed: the identity was never the client's to state.
 */
export async function createTokenRequest(userId: string): Promise<Ably.TokenRequest> {
  return rest().auth.createTokenRequest({
    clientId: userId,
    capability: JSON.stringify(capabilityFor(userId)),
    ttl: TOKEN_TTL_MS,
  });
}

/**
 * Delivers an event to each of a conversation's two ends.
 *
 * Both, and the sender's own inbox is not redundant: it is how their other
 * tabs and their phone learn about a message they sent from this one.
 *
 * **Never throws.** A failed publish means the row is written and the channel
 * missed it, which every client repairs the next time it loads a thread — a
 * far better outcome than telling somebody their message failed when it is
 * safely saved. This is the line that makes "Postgres is the source of truth"
 * true in practice rather than only in a docblock.
 */
export async function publishToBoth(
  userIds: readonly string[],
  event: MessageRealtimeEvent,
): Promise<void> {
  const key = env().ABLY_API_KEY;
  if (!key) return;

  await Promise.all([...new Set(userIds)].map((userId) => publish(key, userChannel(userId), event)));
}

async function publish(key: string, channel: string, event: MessageRealtimeEvent): Promise<void> {
  try {
    const response = await fetch(
      `${REST_ORIGIN}/channels/${encodeURIComponent(channel)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(key).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );

    if (!response.ok) {
      console.error('[messages] publish failed', response.status, await response.text());
    }
  } catch (error) {
    console.error('[messages] publish failed', error);
  }
}
