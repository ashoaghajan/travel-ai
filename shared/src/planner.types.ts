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
 * What a conversation said about how the days should run.
 *
 * Overrides, not a complete record: every field is optional because the model
 * must only report what somebody actually said. The account's own saved
 * preferences are the base, and the client merges these over them — so "we're
 * late risers" moves `dayStart` for this trip and leaves the rest of somebody's
 * settings alone, and a conversation that mentioned none of this changes
 * nothing.
 *
 * The shape mirrors `ApiTravelPreferences`, one level deeper: `meals` is
 * partial here too, because saying "no big dinners" is not a statement about
 * lunch.
 */
export type PlannerPreferenceOverrides = {
  /** `HH:MM`. */
  dayStart?: string;
  /** `HH:MM`. */
  dayEnd?: string;
  pace?: 'relaxed' | 'balanced' | 'packed';
  /** 0 to 1 per category. Zero means never — see the planner. */
  categoryWeights?: Record<string, number>;
  /** USD per person. Null clears a ceiling the account had set. */
  maxActivityPrice?: number | null;
  dailyActivityBudget?: number | null;
  meals?: { lunch?: boolean; dinner?: boolean };
};

/**
 * A trip stated as constraints — the validated `plan_trip` tool input.
 *
 * **The model no longer writes the days.** It used to: `create_itinerary` took
 * a whole itinerary, every activity of it, and the app rendered what came
 * back. That produced good prose and unreliable trips — a museum that closed in
 * 2019, two things at once, a budget quietly ignored — because a language model
 * is being asked to satisfy constraints, which is the one thing it cannot be
 * made to do reliably.
 *
 * So the work is split at the seam it should always have had. The model reads
 * a paragraph and fills this in, which is a language problem. The scheduler
 * turns it into days from a catalogue of places that exist, which is an
 * arithmetic problem. Neither is asked to do the other's job, and the same
 * days come out for a free account, which never calls a model at all.
 */
export type PlannerTripBrief = {
  /** Short and evocative. Falls back to "<destination> Trip" when absent. */
  title?: string;
  /** The label shown on cards, e.g. "Kyoto". */
  destination: string;
  destinationCity?: string;
  destinationCountry?: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate: string;
  /** Nights plus one — the number of dated days the trip covers. */
  days: number;
  travellers: number;
  /**
   * Where they are staying, as they named it.
   *
   * Asked for only when it changes the trip. "Distance from your hotel" is a
   * radius around a point, and without a name that point is the middle of the
   * city — which is a different promise from the one the settings screen
   * makes. So the model is told to ask before it plans whenever that limit is
   * set, and to leave this out when the answer is that nothing is booked.
   *
   * A name, not a booking. The client geocodes it, and a name that cannot be
   * found falls back to the centre rather than failing the trip.
   */
  hotelName?: string;
  preferences?: PlannerPreferenceOverrides;
  /**
   * Whole-trip travel and lodging, in USD, as the model estimated them.
   *
   * Kept from the old plan shape, and one of the few things the model is still
   * better at than this app: it knows roughly what a flight to Osaka costs in
   * March, where the scheduler has only a flat per-traveller constant. Absent
   * on the free path, which falls back to that constant.
   */
  flightsEstimate?: number;
  hotelsEstimate?: number;
};

/* ------------------------------------------------------------ the events */

/** One chunk of the reply. Many of these arrive per turn. */
export type PlannerDeltaEvent = { type: 'delta'; text: string };

/**
 * The model has understood the trip. At most one per turn.
 *
 * Not a trip yet — the client schedules it from this, which is why the event
 * carries constraints rather than days.
 */
export type PlannerBriefEvent = { type: 'brief'; brief: PlannerTripBrief };

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
  | PlannerBriefEvent
  | PlannerDoneEvent
  | PlannerErrorEvent;
