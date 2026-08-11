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
