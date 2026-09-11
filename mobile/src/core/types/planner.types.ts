import type { PlannerTripBrief } from '@ai-travel/shared';
import type { ActivityCategory, LatLng, TripDraft } from './trip.types';

export type ChatAuthor = 'user' | 'ai';

/**
 * A single turn in the planner conversation. An AI turn may carry the trip it
 * generated, or the question it is waiting on an answer to; the message list
 * renders a trip card under the first and a list of places under the second.
 */
export type PlannerMessage = {
  id: string;
  author: ChatAuthor;
  content: string;
  trip?: TripDraft;
  /**
   * The stay question this message asked, and everything needed to carry on.
   *
   * On the message rather than in the hook so the conversation and the thing
   * it is waiting for cannot drift apart: the transcript is persisted, so a
   * reload, a second tab or a phone picking the conversation up all resume in
   * the same place, and a reader who wanders off leaves nothing to clean up.
   */
  pendingStay?: PendingStay;
  /**
   * The stay this turn settled, remembered for the rest of the conversation.
   *
   * Without it every follow-up asks again: "make it five days" is a fresh
   * brief with the same radius on it, and being made to confirm the same hotel
   * three times over is how a question that earns its place becomes an
   * obstacle.
   *
   * Kept with its destination, because that is what makes it safe to reuse. A
   * second trip in one conversation is usually to somewhere else, and a hotel
   * in Tbilisi is not evidence about a trip to Lisbon.
   */
  confirmedStay?: ConfirmedStay;
};

/** A settled stay, and the trip it was settled for. `null` is "there isn't one". */
export type ConfirmedStay = {
  destination: string | null;
  stay: ResolvedStay | null;
};

/* ------------------------------------------------------- where they are staying */

/**
 * One place the stay lookup came back with.
 *
 * A list is offered rather than a best guess even when it holds one entry:
 * hotel names are not unique within a city, let alone between them, and a
 * radius drawn around the wrong building removes a city's worth of places from
 * a trip without anything on screen saying why. See `planner.stay.ts`.
 */
export type StayCandidate = {
  id: string;
  /** "Rooms Hotel Tbilisi". */
  name: string;
  /** The rest of the address, for telling two of the same name apart. */
  address: string;
  coordinates: LatLng;
};

/** A stay with a point on it, which is the only form the scheduler can use. */
export type ResolvedStay = {
  name: string;
  coordinates: LatLng;
};

/**
 * The trip a stay question is holding up.
 *
 * Two shapes because the two engines hold a trip at different stages. The free
 * one has not started — it is a sentence, replayed in full once the stay is
 * known, so the dates and the party size in it are not lost. The model has
 * already read its sentence and answered with constraints, and running it
 * again to ask it the same thing would cost a second paid turn to learn
 * nothing.
 */
export type StayResume =
  | { kind: 'prompt'; prompt: string }
  | { kind: 'brief'; brief: PlannerTripBrief };

/**
 * What the planner was in the middle of doing when it asked.
 *
 * Plain data, because it is persisted with the transcript.
 */
export type PendingStay = {
  step: 'name' | 'choose' | 'address';
  /** The city, for the question's wording and to narrow the lookup. */
  destination: string | null;
  /** What was named at the first step, once it has been. */
  name?: string;
  /** Only on `choose`, and never empty when present. */
  candidates?: StayCandidate[];
  /** What to carry on with once the stay is settled. */
  resume: StayResume;
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
  /**
   * The planner asked something instead of answering, and this is what it is
   * waiting for. Never set alongside `trip` — the question is what stopped the
   * trip being built. See `planner.stay.ts`.
   */
  pendingStay?: PendingStay;
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
  /**
   * How far from the trip's base a place may be, in whole kilometres. Null for
   * no limit.
   *
   * **The base is the hotel when there is one and the city centre when there
   * is not**, which is the case the planner usually runs in — a trip is
   * generated before anything is booked. The setting is offered in the
   * reader's terms ("from your hotel") and the screen says which of the two it
   * will measure from, because those are two different promises.
   *
   * Straight-line, not walking distance. The scheduler already measures its
   * transfers that way (`distanceKm`), and a rule that disagreed with the
   * timings beside it would be the more confusing of the two.
   */
  maxDistanceFromHotelKm: number | null;
  /**
   * Whether to plan only places within walking distance of a metro station.
   *
   * Inert where there is no metro to be near — see `isNearMetro`. Somebody who
   * leaves this on and goes to a city without a metro has not asked for an
   * empty trip.
   */
  nearMetroOnly: boolean;
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
  /**
   * The hotel this trip is based in, as somebody named it.
   *
   * Only ever read by `maxDistanceFromHotelKm`, and only worth asking for when
   * that is set — which is why both planners ask at that moment rather than
   * collecting it on every trip. Absent means nobody said, and the radius is
   * then measured from a booked stay if there is one and from the middle of
   * the city if there is not.
   *
   * A name rather than a point, because a name is what a person has. Turning
   * it into a point is `planning.context.ts`'s job and is allowed to fail.
   */
  hotelName?: string;
  /**
   * The same hotel, already placed.
   *
   * Set when the reader picked it off a list or gave an address that resolved
   * — which is the ordinary case, because the planner confirms a stay before
   * it plans. It is carried separately from the name so the lookup is not
   * repeated, and more importantly so it is not repeated *differently*: a name
   * looked up twice can come back as two buildings, and the one the reader
   * pointed at is the one the radius has to be drawn around.
   */
  hotelLocation?: LatLng;
  preferences: TravelPreferences;
};
