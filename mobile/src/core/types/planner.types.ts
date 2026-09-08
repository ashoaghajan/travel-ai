import type { ActivityCategory, TripDraft } from './trip.types';

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

/* ------------------------------------------------- the scheduler's own input */

/**
 * How somebody wants their days to run.
 *
 * The templates in `mock/destinations.ts` could not answer any of these: their
 * times, their activities and their prices were written into the template, so
 * the engine never chose an activity and had nothing to apply a preference to.
 * `itinerary.planner.ts` chooses, and this is what it chooses against.
 *
 * Every field has a defensible default (`DEFAULT_PREFERENCES`) because the
 * planner must produce a trip for somebody who has never opened the settings
 * screen. Nothing here is required of the reader.
 */
export type TravelPreferences = {
  /** `HH:MM`. The earliest the first activity of a day may start. */
  dayStart: string;
  /** `HH:MM`. Nothing is scheduled to begin after this. */
  dayEnd: string;
  /**
   * How full a day is: two things, three, or five.
   *
   * Named rather than a number because the number alone is a poor question to
   * ask somebody — "how many activities per day?" has no obvious right answer,
   * where "relaxed or packed?" does.
   */
  pace: 'relaxed' | 'balanced' | 'packed';
  /**
   * How much each category is wanted, 0 to 1.
   *
   * **Zero means never.** It is the one value with a hard meaning rather than
   * a weighting: somebody who sets `adventure` to zero has said they do not
   * want to climb a volcano, and no amount of notability should overrule that.
   */
  categoryWeights: Record<ActivityCategory, number>;
  /**
   * Most that may be spent on one activity, per person, in USD. Null for no
   * ceiling.
   *
   * Applied against `Activity.price`, which is a real quoted figure only for
   * priced products — see `maxActivityPrice` handling in the planner for what
   * a zero price is taken to mean.
   */
  maxActivityPrice: number | null;
  /** Most that may be spent across one day, per person, in USD. Null for none. */
  dailyActivityBudget: number | null;
  /** Whether to hold time open for a meal, and look for somewhere to eat. */
  meals: { lunch: boolean; dinner: boolean };
};

/**
 * A trip, stated as constraints rather than as a sentence.
 *
 * This is the seam that makes the planner independent of any language model:
 * a model can produce one of these from a paragraph, and so can a form, and so
 * can `intent.ts` reading a keyword. Whatever fills it in, the days are built
 * the same way from the same rules.
 */
export type TripBrief = {
  destination: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate: string;
  days: number;
  travellers: number;
  preferences: TravelPreferences;
};
