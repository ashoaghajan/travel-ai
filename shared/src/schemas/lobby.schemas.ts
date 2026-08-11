import { z } from 'zod';
import { LOBBY_MESSAGE_MAX_LENGTH } from '../lobby.types';

/**
 * What the server will accept into the lobby.
 *
 * Short, because there is very little to a message — which is the point. The
 * body is plain text and stays that way: nothing renders it as markup, nothing
 * turns URLs in it into links, and so there is nothing here to sanitise beyond
 * a length and a non-empty check.
 *
 * Server-only, behind the `@ai-travel/shared/schemas` export path.
 */

export const sendLobbyMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(LOBBY_MESSAGE_MAX_LENGTH, `Keep it under ${LOBBY_MESSAGE_MAX_LENGTH} characters.`),
  /**
   * The browser's own id for this message.
   *
   * Required, not optional: it is what makes a retry idempotent, and a client
   * that omitted it would silently lose that protection at exactly the moment
   * it matters — a slow first attempt the reader gives up on and repeats.
   */
  clientMessageId: z.string().trim().min(1).max(100),
});

export type SendLobbyMessageBody = z.infer<typeof sendLobbyMessageSchema>;

/** How many ids the roster query will read. Matches the roster's own cap. */
const ONLINE_IDS_LIMIT = 200;

/**
 * Who the caller can see in the presence set, as `?online=id,id,id`.
 *
 * The client is the only thing that knows this: presence lives in Ably and
 * this server never joins it. Passing the ids up is what lets someone who has
 * connected but never posted appear in the roster at all — the directory is
 * otherwise "everyone who has spoken".
 *
 * Untrusted, and it does not need to be trusted. The ids are used only to
 * widen a lookup that already projects `id` and `name`, so the worst a forged
 * one can do is name an account that exists — which every caller can already
 * enumerate by reading the room. It cannot reveal an address and it cannot
 * write anything.
 */
export const lobbyPeopleQuerySchema = z.object({
  online: z
    .string()
    .trim()
    .max(ONLINE_IDS_LIMIT * 40)
    .optional()
    .transform((value) =>
      value
        ? [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))].slice(
            0,
            ONLINE_IDS_LIMIT,
          )
        : [],
    ),
});
