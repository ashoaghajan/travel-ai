import type { TripDraft } from './trip.types';

export type ChatAuthor = 'user' | 'ai';

/**
 * A single turn in the planner conversation. An AI turn may carry the trip it
 * generated; the message list renders its cards under that bubble.
 */
export type PlannerMessage = {
  id: string;
  author: ChatAuthor;
  content: string;
  trip?: TripDraft;
};

export type PlannerStatus = 'idle' | 'generating' | 'error';

/**
 * What the planner returns for a prompt.
 *
 * `trip` is optional because not every prompt asks for one. A question about
 * the weather gets an answer and no itinerary — the planner used to build one
 * regardless, which is how "what is the weather in Abu Dhabi?" produced a
 * five-day Abu Dhabi trip. See `classifyPrompt`.
 */
export type GeneratedItinerary = {
  /** The reply shown in the conversation. */
  reply: string;
  trip?: TripDraft;
};

// `User` used to live here, describing the guest that everyone was. The
// account the server returns is `ApiUser` in `@ai-travel/shared` — one
// definition, shared by both sides of the wire.
