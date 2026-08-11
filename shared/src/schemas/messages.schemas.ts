import { z } from 'zod';
import { CONVERSATION_LIMIT, MESSAGE_MAX_LENGTH } from '../messages.types';

/**
 * What the server will accept into a conversation.
 *
 * Short, because there is very little to a message — which is the point. The
 * body is plain text and stays that way: nothing renders it as markup, nothing
 * turns URLs in it into links, and so there is nothing here to sanitise beyond
 * a length and a non-empty check.
 *
 * Server-only, behind the `@ai-travel/shared/schemas` export path.
 */

export const sendDirectMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(MESSAGE_MAX_LENGTH, `Keep it under ${MESSAGE_MAX_LENGTH} characters.`),
  /**
   * The browser's own id for this message.
   *
   * Required, not optional: it is what makes a retry idempotent, and a client
   * that omitted it would silently lose that protection at exactly the moment
   * it matters — a slow first attempt the reader gives up on and repeats.
   */
  clientMessageId: z.string().trim().min(1).max(100),
});

export type SendDirectMessageBody = z.infer<typeof sendDirectMessageSchema>;

/**
 * Narrowing the people list.
 *
 * Every account is listed, so on any real user base the list needs a way to
 * find one — and the cap has to exist whether or not anybody searches.
 */
export const conversationsQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(CONVERSATION_LIMIT).default(CONVERSATION_LIMIT),
});
