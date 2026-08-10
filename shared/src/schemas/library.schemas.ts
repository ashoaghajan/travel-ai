import { z } from 'zod';

/**
 * Saved attractions, recent searches and the planner conversation.
 *
 * Three small domains sharing a file because none of them justifies one, and
 * they arrived together. Server-only, behind the `@ai-travel/shared/schemas`
 * export path so zod never reaches the browser bundle.
 */

/* ------------------------------------------------------- saved activities */

/**
 * The whole `Activity`, passed through.
 *
 * `passthrough` because the explorer's shape is the provider's and gains
 * fields — a photograph credit, a source URL — without this file hearing about
 * it. The four named below are the ones the server reads to fill its own
 * columns; the rest is stored as given. Bounded by the outer request limit
 * rather than field by field.
 */
export const savedActivitySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    category: z.enum(['food', 'nature', 'culture', 'adventure', 'relaxation', 'travel']),
    description: z.string().max(5000).default(''),
  })
  .passthrough();

export const saveActivityBodySchema = z.object({
  activity: savedActivitySchema,
  /**
   * When the reader saved it, for an import that has to preserve order.
   *
   * Absent on a live save, where "now" is the only sensible answer and the
   * client's clock is not worth trusting over the server's.
   */
  savedAt: z.string().trim().max(100).optional(),
});

/* --------------------------------------------------------- recent searches */

export const flightSearchSchema = z.object({
  tripType: z.enum(['one-way', 'round-trip']),
  from: z.string().trim().max(10),
  to: z.string().trim().max(10),
  departDate: z.string().trim().max(20),
  returnDate: z.string().trim().max(20).optional(),
  travellers: z.number().int().min(1).max(9),
});

export const saveSearchBodySchema = z.object({
  query: flightSearchSchema,
  searchedAt: z.string().trim().max(100).optional(),
});

/* ------------------------------------------------------------ chat history */

/**
 * One message in the planner conversation.
 *
 * `passthrough` for the same reason as an activity: an AI turn carries a whole
 * `TripDraft` alongside its text, and re-describing that here would be a
 * second copy of the trip schema kept in step by hand.
 */
export const plannerMessageSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    author: z.enum(['user', 'ai']),
    text: z.string().max(20_000).default(''),
  })
  .passthrough();

export const chatHistorySchema = z.object({
  /** Bounded: a conversation is a screen's worth of scrollback, not a log. */
  messages: z.array(plannerMessageSchema).max(500),
});

export type SaveActivityBody = z.infer<typeof saveActivityBodySchema>;
export type SaveSearchBody = z.infer<typeof saveSearchBodySchema>;
export type ChatHistoryBody = z.infer<typeof chatHistorySchema>;
