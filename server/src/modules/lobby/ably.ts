import { LOBBY_CHANNEL } from '@ai-travel/shared';
import type { ApiLobbyMessage } from '@ai-travel/shared';
import Ably from 'ably';
import { env } from '../../env';

/**
 * The lobby's realtime provider.
 *
 * The only file that knows Ably exists. Two jobs, done two different ways on
 * purpose:
 *
 * **Signing a token** goes through the SDK. The signature is an HMAC over an
 * exact canonical string, and a hand-rolled version fails in a way nothing
 * catches until a browser refuses to connect. It is also offline — no request
 * leaves this process — which is what keeps the token endpoint fast even on a
 * cold instance.
 *
 * **Publishing** is a plain `fetch` to one REST URL, like every other provider
 * in this codebase, so it stubs at `fetch` in tests rather than needing the
 * SDK's own HTTP layer mocked.
 */

const REST_ORIGIN = 'https://rest.ably.io';

/** An hour, deliberately unrelated to the 15-minute access token. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * What a browser is allowed to do with the token this server signs.
 *
 * `subscribe` receives messages and presence changes; `presence` is a separate
 * capability covering enter, update and leave. **`publish` is deliberately
 * absent** — every message goes through `POST /api/lobby/messages`, where it is
 * validated, rate-limited and written down before anyone sees it. Without that
 * omission a client could put anything on the channel under its own name and
 * every other client would have to re-validate what it received.
 */
const CAPABILITY = { [LOBBY_CHANNEL]: ['subscribe', 'presence'] } as const;

/** What goes on the wire when a message is sent or withdrawn. */
export type LobbyRealtimeEvent =
  | { name: 'message'; data: ApiLobbyMessage }
  | { name: 'delete'; data: { id: string } };

let client: Ably.Rest | null = null;

/** Whether the realtime half of the lobby is switched on at all. */
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
export function resetAblyClient(): void {
  client = null;
}

/**
 * A signed token request for one account.
 *
 * `clientId` is set here and enforced by Ably, so a browser cannot join the
 * channel as somebody else. That is the whole basis on which the presence list
 * can be believed: the identity was never the client's to state.
 */
export async function createTokenRequest(userId: string): Promise<Ably.TokenRequest> {
  return rest().auth.createTokenRequest({
    clientId: userId,
    capability: JSON.stringify(CAPABILITY),
    ttl: TOKEN_TTL_MS,
  });
}

/**
 * Fans a message out to everyone connected.
 *
 * **Never throws.** A failed publish means the row is written and the channel
 * missed it, which every client repairs the next time it loads history — and
 * that is a far better outcome than telling somebody their message failed when
 * it is safely saved. This is the line that makes "Postgres is the source of
 * truth" true in practice rather than only in the docblock.
 */
export async function publishMessage(event: LobbyRealtimeEvent): Promise<void> {
  const key = env().ABLY_API_KEY;
  if (!key) return;

  try {
    const response = await fetch(
      `${REST_ORIGIN}/channels/${encodeURIComponent(LOBBY_CHANNEL)}/messages`,
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
      console.error('[lobby] publish failed', response.status, await response.text());
    }
  } catch (error) {
    console.error('[lobby] publish failed', error);
  }
}
