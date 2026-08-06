import type { ErrorCode } from './error-codes';

/**
 * The planner conversation wire format — `POST /api/planner/chat`.
 *
 * The one endpoint in this API that streams. Its response is
 * `text/event-stream` rather than JSON, so the standard error envelope only
 * applies to failures that happen *before* the first byte; after that a failure
 * arrives as a `PlannerErrorEvent` on the stream itself.
 */

export type PlannerAuthor = 'user' | 'ai';

export type PlannerChatMessage = {
  author: PlannerAuthor;
  content: string;
};

export type PlannerChatRequest = {
  /** Oldest first, the newest being the prompt just typed. */
  messages: PlannerChatMessage[];
};

/**
 * A day the model proposed.
 *
 * Deliberately not an `ItineraryDay`: no ids and no images, because the model
 * cannot know either. Ids come from the client's `createId`, and the photos are
 * Vite-bundled assets the server cannot reference by URL.
 */
export type PlannerActivityPlan = {
  /** 24-hour display time, e.g. "09:30". */
  time: string;
  title: string;
  description: string;
  category: 'food' | 'nature' | 'culture' | 'adventure' | 'relaxation' | 'travel';
  /** Per person, in USD. Zero for anything free. */
  priceEstimate?: number;
};

export type PlannerDayPlan = {
  /** Where this day is spent — a district or a nearby town, not the country. */
  destination: string;
  summary: string;
  activities: PlannerActivityPlan[];
};

/** The validated `create_itinerary` tool input, passed through unchanged. */
export type PlannerItineraryPlan = {
  title: string;
  /** The label shown on cards, e.g. "Kyoto". */
  destination: string;
  destinationCity?: string;
  destinationCountry?: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  travellers: number;
  days: PlannerDayPlan[];
  /** Whole-trip totals in USD, as the model estimated them. */
  flightsEstimate?: number;
  hotelsEstimate?: number;
};

/* ------------------------------------------------------------ the events */

/** One chunk of the reply. Many of these arrive per turn. */
export type PlannerDeltaEvent = { type: 'delta'; text: string };

/** The model proposed a trip. At most one per turn. */
export type PlannerItineraryEvent = { type: 'itinerary'; plan: PlannerItineraryPlan };

/** The turn finished normally. Always last when it appears. */
export type PlannerDoneEvent = { type: 'done'; stopReason: string | null };

/**
 * The turn failed. Also always last.
 *
 * Carries the same `code`/`message` pair as the JSON error envelope so a client
 * can handle both paths identically — the status line has already been sent by
 * the time this can happen, which is why it cannot be an HTTP status.
 */
export type PlannerErrorEvent = { type: 'error'; code: ErrorCode; message: string };

export type PlannerStreamEvent =
  | PlannerDeltaEvent
  | PlannerItineraryEvent
  | PlannerDoneEvent
  | PlannerErrorEvent;
