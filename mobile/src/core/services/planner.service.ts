import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerChatMessage, PlannerStreamEvent, PlannerTripBrief } from '@ai-travel/shared';
import type {
  ConfirmedStay,
  GeneratedItinerary,
  PendingStay,
  ResolvedStay,
  StayResume,
  TravelPreferences,
  TripBrief,
} from '../types/planner.types';
import type { ActivityCategory, TripDraft } from '../types/trip.types';
import { classifyPrompt } from '../utils/intent';
import { ApiError, stream } from './http';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { NoPlacesInRangeError, destinationNameIn, mockAiService, tripForBrief } from './mockAi.service';
import type { TripExtras } from './mockAi.service';
import { advanceStay, beginStay } from './planner.stay';
import type { StayStep } from './planner.stay';
import { PlaceNotFoundError, weatherService } from './weather.service';

/**
 * The planner API the app codes against.
 *
 * Two paths behind one door.
 *
 * The real one is Claude, reached through `POST /api/planner/chat` and read as
 * it is written, so a reply appears a few words at a time rather than after a
 * long blank pause. The model can answer anything about travel and can plan a
 * trip to anywhere, because it is writing the days rather than filling in a
 * template.
 *
 * The other is the rules engine below — `classifyPrompt` in front of Open-Meteo
 * and the mock generator. It is what runs when the server has no
 * `ANTHROPIC_API_KEY`, so a fresh clone still answers weather and location
 * questions and still produces a trip. Same reasoning as the flight search
 * falling back to sample fares: a missing key should degrade the app, not break
 * it.
 *
 * The fallback is only ever taken *before* the first word arrives. Once the
 * model has started talking, a failure is reported as a failure — quietly
 * restarting with a different answer half way through a sentence would be
 * worse than the error.
 */

const NO_PLACE =
  "Which place did you mean? Ask me like “what's the weather in Lisbon?” and I'll look it up.";

const CANNOT_ANSWER =
  "I can't answer that one yet — I can look up the weather and where a place is, and I can plan a trip. Try one of those, or tell me where you'd like to go.";

/**
 * One sentence, appended wherever the rule engine has just admitted a limit.
 *
 * There are two such moments, not one. `unknown` is the obvious one — but
 * `intent.ts` is eager, and a question like "what should I pack for a cold
 * climate?" is read as a place lookup and dies as "I could not find a place
 * called 'a cold climate'". That dead end is the ceiling being felt just as
 * much as `unknown` is, and it is reached far more often.
 *
 * Empty for everyone else. `chat`'s no-key fallback reaches the same code on
 * a Pro account, and selling Pro to somebody who has it would be nonsense.
 */
const PRO_HINT = 'Pro plans with Claude, and can answer questions like this one.';

const OFFER_TRIP = 'Want me to plan a trip there?';

function weatherUnavailable(place: string): string {
  return `I could not reach the weather service for ${place} just now. ${OFFER_TRIP}`;
}

/** "Abu Dhabi, United Arab Emirates" — the region only when it adds something. */
function placeLabel(facts: { name: string; region?: string; country?: string }): string {
  const parts = [facts.name];
  if (facts.region && facts.region !== facts.name) parts.push(facts.region);
  if (facts.country) parts.push(facts.country);

  return parts.join(', ');
}

async function answerWeather(place: string | null, proHint = ''): Promise<GeneratedItinerary> {
  if (!place) return { reply: NO_PLACE };

  try {
    const report = await weatherService.getWeather(place);
    const where = report.country ? `${report.place}, ${report.country}` : report.place;

    return {
      reply: `It's ${report.temperature}°C and ${report.description} in ${where} right now, with a high of ${report.high}°C and a low of ${report.low}°C today. ${OFFER_TRIP}`,
    };
  } catch (error) {
    if (error instanceof PlaceNotFoundError) {
      return { reply: [`I could not find a place called “${place}”.`, OFFER_TRIP, proHint].filter(Boolean).join(' ') };
    }
    return { reply: weatherUnavailable(place) };
  }
}

async function answerLocation(place: string | null, proHint = ''): Promise<GeneratedItinerary> {
  if (!place) return { reply: NO_PLACE };

  try {
    const facts = await weatherService.findPlace(place);
    const coordinates = `${Math.abs(facts.latitude).toFixed(2)}°${facts.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(facts.longitude).toFixed(2)}°${facts.longitude >= 0 ? 'E' : 'W'}`;
    const timezone = facts.timezone ? ` Its timezone is ${facts.timezone}.` : '';

    return {
      reply: `${placeLabel(facts)} sits at ${coordinates}.${timezone} ${OFFER_TRIP}`,
    };
  } catch (error) {
    if (error instanceof PlaceNotFoundError) {
      return { reply: [`I could not find a place called “${place}”.`, OFFER_TRIP, proHint].filter(Boolean).join(' ') };
    }
    return { reply: weatherUnavailable(place) };
  }
}

/* ------------------------------------------------------- the model's answer */

/**
 * The model's brief, merged with the account's own preferences.
 *
 * The account is the base and the conversation is the override, which is the
 * only order that makes sense: settings are a standing answer and a sentence
 * is about this trip. Somebody who set a $40 ceiling in March and says nothing
 * about money in June still has a $40 ceiling.
 *
 * Absent means "not mentioned"; `null` on a budget means "no ceiling", said
 * out loud. The spread gets both right for free — a key the model omitted is
 * not spread at all, and a null one is.
 */
function toTripBrief(
  brief: PlannerTripBrief,
  base: TravelPreferences,
  stay?: ResolvedStay | null,
): TripBrief {
  const overrides = brief.preferences ?? {};

  const categoryWeights = { ...base.categoryWeights };
  for (const [category, weight] of Object.entries(overrides.categoryWeights ?? {})) {
    // Only the categories this app has. The tool schema offers exactly these,
    // so anything else is a model inventing a taxonomy, and a weight the
    // planner will never read is not worth carrying into a trip.
    if (category in categoryWeights) categoryWeights[category as ActivityCategory] = weight;
  }

  return {
    destination: brief.destination,
    startDate: brief.startDate,
    days: brief.days,
    travellers: brief.travellers,
    /*
     * The confirmed stay beats the model's, and that is not a matter of trust
     * — it is that one of them has been placed. The model can only ever hand
     * over a name, and a name is what the confirmation flow turns into a
     * building the reader pointed at. Its name is kept where there is no
     * confirmation, so an older conversation still gets a lookup.
     */
    hotelName: stay === undefined ? brief.hotelName : (stay?.name ?? undefined),
    hotelLocation: stay?.coordinates,
    preferences: {
      ...base,
      ...overrides,
      categoryWeights,
      meals: { ...base.meals, ...overrides.meals },
    },
  };
}

/**
 * Whether a stay already settled in this conversation covers this prompt.
 *
 * **Asking for a trip is asking again.** A sentence that names a city is a new
 * trip, and a new trip gets the question — the hotel somebody gave an hour ago
 * is not an answer about a trip they have only just described. A sentence that
 * names no city is a refinement of the trip already on screen ("make it five
 * days", "more food"), and re-asking there is the thing this exists to stop.
 *
 * The first version of this had the test the other way round, matching on the
 * destination, and so did exactly the wrong thing in both directions: it went
 * quiet on "create a new trip in Tbilisi" and asked again on "make it 5 days".
 *
 * `undefined` means "nothing settled, ask"; `null` means "settled, and there
 * is no hotel". The difference is why this returns three things rather than two.
 */
function staySettledForPrompt(
  known: ConfirmedStay | undefined,
  prompt: string,
): ResolvedStay | null | undefined {
  if (!known) return undefined;

  return destinationNameIn(prompt) === null ? known.stay : undefined;
}

/**
 * The same question for the model's brief, which always names a destination.
 *
 * So the free engine's test — "did this sentence name a city?" — cannot be
 * used here: every brief names one, and applying it would ask again on every
 * turn. What stands in for it is the hotel the model passed back. It reads the
 * whole conversation, so on a refinement it repeats the name already given,
 * and a name that matches the building somebody has already pointed at is not
 * worth confirming twice. Anything else — a different hotel, a different city,
 * a brief that dropped the name — is a question again.
 */
function staySettledForBrief(
  known: ConfirmedStay | undefined,
  brief: PlannerTripBrief,
): ResolvedStay | null | undefined {
  if (!known) return undefined;

  const had = known.destination?.trim().toLowerCase();
  if (!had || had !== brief.destination.trim().toLowerCase()) return undefined;

  const said = brief.hotelName?.trim().toLowerCase();

  // They said there is no hotel, and the model is still not naming one.
  if (!said) return known.stay === null ? null : undefined;

  return said === known.stay?.name.trim().toLowerCase() ? known.stay : undefined;
}

/** The model's own contributions to a trip, which the scheduler cannot work out. */
function extrasOf(brief: PlannerTripBrief): TripExtras {
  return {
    title: brief.title,
    // Straight from the model, and the reason this path needs no geocoding:
    // it named the city and the country itself.
    destinationCity: brief.destinationCity,
    destinationCountry: brief.destinationCountry,
    flightsEstimate: brief.flightsEstimate,
    hotelsEstimate: brief.hotelsEstimate,
  };
}

/**
 * Where the model's trip is based, settled before it is scheduled.
 *
 * The model is told to ask for the hotel and usually has, but what it comes
 * back with is a *name* — and a name is not a place. It goes through the same
 * lookup and the same confirmation a typed one does, because "Grand Hotel" is
 * as ambiguous when a model repeats it as when a person types it, and the
 * model has no way to tell which of the four in the city was meant either.
 *
 * When it did not ask, this asks. That is the fallback rather than the plan:
 * the question reads better in the middle of the model's own sentence than
 * tacked onto the end of it.
 */
function settleStay(brief: PlannerTripBrief, limitKm: number): Promise<StayStep> {
  const resume: StayResume = { kind: 'brief', brief };
  const named = brief.hotelName?.trim();

  if (named) {
    return advanceStay({ step: 'name', destination: brief.destination, resume }, named);
  }

  return Promise.resolve(beginStay(resume, brief.destination, limitKm));
}

export type PlannerHandlers = {
  /** One chunk of the reply. Append it — do not replace what came before. */
  onText: (text: string) => void;
  /** The model proposed a trip. At most once per message. */
  onTrip: (trip: TripDraft) => void;
  /**
   * The planner cannot build the trip until it knows where they are staying.
   *
   * Arrives *instead of* a trip, never alongside one, and the question itself
   * has already gone out through `onText` — this carries only what the caller
   * has to hang on to in order to resume. See `planner.stay.ts`.
   */
  onStayNeeded: (pending: PendingStay) => void;
};

/** A failure the chat should show, distinct from one worth falling back on. */
export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}

/**
 * The offline planner: what this app answered before it had a model.
 *
 * Kept whole rather than trimmed to a stub, because it is a genuine second
 * implementation — every answer it gives is a real lookup — and it is what runs
 * on any deployment without a key.
 */
async function answerOffline(
  prompt: string,
  {
    proHint = '',
    preferences,
    stay,
  }: {
    proHint?: string;
    preferences?: TravelPreferences;
    /**
     * `undefined` means nobody has been asked yet, and is the reason the stay
     * question is not asked twice for one trip. `null` is an answer — they
     * said there is no hotel — and plans from the centre.
     */
    stay?: ResolvedStay | null;
  } = {},
): Promise<GeneratedItinerary> {
  const intent = classifyPrompt(prompt);

  switch (intent.kind) {
    case 'weather':
      return answerWeather(intent.place, proHint);
    case 'location':
      return answerLocation(intent.place, proHint);
    case 'unknown':
      return { reply: [CANNOT_ANSWER, proHint].filter(Boolean).join(' ') };
    case 'trip':
    default: {
      /*
       * The one question that has to come before the days.
       *
       * A radius is measured from a point, and until somebody says which
       * hotel, the only point this engine has is the middle of the city — so
       * "within 2 km of your hotel" quietly became "within 2 km of the town
       * hall" for every trip planned before a booking existed. Asking costs a
       * turn; getting it wrong costs a city.
       */
      const limit = preferences?.maxDistanceFromHotelKm ?? null;

      if (limit !== null && stay === undefined) {
        const step = beginStay({ kind: 'prompt', prompt }, destinationNameIn(prompt), limit);

        // `ask` is the only thing `beginStay` returns; the narrowing is for
        // the type rather than for a case that can happen.
        if (step.kind === 'ask') return { reply: step.reply, pendingStay: step.pending };
      }

      return withDestinationFacts(
        await mockAiService.generateItinerary(prompt, preferences, stay),
      );
    }
  }
}

/**
 * Labels the templates use that are not places, and must never be looked up.
 *
 * A prompt naming nowhere yields "Your destination", and asking the geocoder
 * about it is a request whose failure is known in advance.
 */
const NON_PLACES = new Set(['your destination', 'departure', 'home']);

/**
 * The city and country a template itinerary cannot know.
 *
 * `mockAiService` reads a destination *name* out of the prompt and stops there,
 * so a trip it built arrived with `destination: 'Lisbon'` and both
 * `destinationCity` and `destinationCountry` empty. The model path fills them in
 * — `toTripDraft` copies them straight off the plan — which is why this was
 * invisible on Pro and broken for everybody else, free being the default tier.
 *
 * The two fields are not decoration. An empty country stops
 * `useDestinationAirport` resolving an arrival airport, so the trip's Flights
 * tab falls back to partner links; an empty city leaves the Hotels tab with
 * nowhere to search and costs the geocoder the hint that tells Valencia, Spain
 * from Valencia, Venezuela.
 *
 * The lookup is the one the planner already makes for a location question, so
 * this adds a request to a path that was going to spend one anyway, and adds no
 * new dependency. Failure costs the country and nothing else: the city is still
 * the name the prompt gave, and the trip is exactly the trip it was before.
 */
async function withDestinationFacts(generated: GeneratedItinerary): Promise<GeneratedItinerary> {
  const { trip } = generated;
  const name = trip?.destination?.trim();

  if (!trip || !name || NON_PLACES.has(name.toLowerCase())) return generated;

  try {
    const facts = await weatherService.findPlace(name);

    return {
      ...generated,
      trip: {
        ...trip,
        destinationCity: facts.name || name,
        destinationCountry: facts.country ?? trip.destinationCountry,
      },
    };
  } catch {
    return { ...generated, trip: { ...trip, destinationCity: name } };
  }
}

/** The codes that mean "this server has no model", rather than "it went wrong". */
function isUnconfigured(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ERROR_CODES.PROVIDER_NOT_CONFIGURED || error.code === ERROR_CODES.NETWORK)
  );
}

export const plannerService = {
  /**
   * One turn of the conversation, streamed.
   *
   * `history` is oldest-first and ends with the prompt just typed. It is
   * replayed in full on every message because the API holds no session — which
   * is also why the caller caps it.
   *
   * `signal` aborts the read. The half of an answer that already arrived stays
   * where it is: the caller has been painting it as it came, and taking it back
   * would be a stranger thing to do than leaving it.
   */
  async chat(
    history: PlannerChatMessage[],
    handlers: PlannerHandlers,
    {
      signal,
      preferences = DEFAULT_PREFERENCES,
      knownStay,
    }: {
      signal?: AbortSignal;
      preferences?: TravelPreferences;
      /** What this conversation has already settled, if anything. */
      knownStay?: ConfirmedStay;
    } = {},
  ): Promise<void> {
    const prompt = history.at(-1)?.content ?? '';
    let started = false;

    /*
     * Started when the brief arrives, awaited after the stream closes.
     *
     * Scheduling means fetching the attraction pool, and the model is still
     * talking at that point — it narrates *after* calling the tool. Awaiting
     * inline would hold back the rest of the sentence somebody is reading for
     * the sake of a card that appears at the end either way.
     */
    let scheduling: Promise<TripDraft> | null = null;

    /**
     * The stay being settled, when the radius is set and nobody has answered.
     *
     * Runs in place of `scheduling` rather than before it: there is no trip to
     * build until the point it is measured from is known. Started as soon as
     * the brief arrives, for the same reason scheduling is — the model is
     * still narrating, and the lookup should not wait for it to finish.
     */
    let settling: Promise<StayStep> | null = null;

    try {
      for await (const event of stream<PlannerStreamEvent>('/planner/chat', {
        body: { messages: history },
        signal,
      })) {
        switch (event.type) {
          case 'delta':
            started = true;
            handlers.onText(event.text);
            break;
          case 'brief':
            started = true;

            {
              // Asked once per destination rather than once per turn: a
              // follow-up that shortens the trip is the same trip, in the
              // same hotel, and confirming it again is an obstacle.
              const settled = staySettledForBrief(knownStay, event.brief);

              if (preferences.maxDistanceFromHotelKm !== null && settled === undefined) {
                settling = settleStay(event.brief, preferences.maxDistanceFromHotelKm);
                break;
              }

              scheduling = tripForBrief(
                toTripBrief(event.brief, preferences, settled),
                extrasOf(event.brief),
              );
            }
            break;
          case 'error':
            // Mid-stream failures arrive here rather than as a rejection: by
            // then the response is already a 200 being read.
            throw new PlannerError(event.message);
          case 'done':
          default:
            break;
        }
      }

      /*
       * The question, after the words, because the model has been talking
       * about a trip it expects to appear. A blank line keeps it off the end
       * of that sentence.
       */
      if (settling) {
        const step = await settling;

        if (step.kind === 'ask') {
          handlers.onText(`\n\n${step.reply}`);
          handlers.onStayNeeded(step.pending);
        } else {
          // The model passed on a "not sure" of its own, so there is nothing
          // to confirm and the trip can be built from the centre.
          if (step.reply) handlers.onText(`\n\n${step.reply}`);
          if (step.resume.kind === 'brief') {
            scheduling = tripForBrief(
              toTripBrief(step.resume.brief, preferences, step.stay),
              extrasOf(step.resume.brief),
            );
          }
        }
      }

      // After the words, because that is the order it happens in: the model
      // calls the tool, talks about the trip, and the card lands under it.
      if (scheduling) handlers.onTrip(await scheduling);
    } catch (caught) {
      /*
       * A radius with nothing inside it, said out loud rather than answered
       * with a template.
       *
       * Appended to what the model already wrote, because by now it has
       * narrated a trip that is not coming — leaving that sentence to stand
       * alone would be the misleading half of this answer.
       */
      if (caught instanceof NoPlacesInRangeError) {
        handlers.onText(`\n\n${caught.message}`);
        return;
      }

      if (started || caught instanceof PlannerError) throw caught;
      if (!isUnconfigured(caught)) throw caught;

      /*
       * Somebody pressed Stop before the first token.
       *
       * Without this the offline fallback would answer a question that has
       * been withdrawn — the one case where "the API is not configured" and
       * "the reader changed their mind" look identical from here.
       */
      if (signal?.aborted) throw caught;

      /*
       * With the account's preferences, which this had always dropped: a Pro
       * reader on a server with no key was quietly planned for as though they
       * had never opened the settings screen. The stay question comes with
       * them, which is right — this is the free engine, and it is the engine
       * that asks.
       */
      const { reply, trip, pendingStay } = await answerOffline(prompt, {
        preferences,
        stay: staySettledForPrompt(knownStay, prompt),
      });
      handlers.onText(reply);
      if (trip) handlers.onTrip(trip);
      if (pendingStay) handlers.onStayNeeded(pendingStay);
    }
  },

  /**
   * One turn from the rule engine, shaped like a turn from the model.
   *
   * What a free account gets, and the same code the no-key fallback in `chat`
   * has always run — given a name of its own now that it is a destination
   * rather than a last resort. The handler shape is identical to `chat`'s, so
   * the transcript, the trip card, Save and Customise cannot tell the two
   * apart, and neither can the caller beyond choosing which to call.
   *
   * It does not stream, because there is nothing to stream: the answer is
   * built locally and arrives whole. That is the honest difference between the
   * tiers and it needs no apology — an instant reply is not a worse one.
   *
   * `signal` is accepted and checked once, on the way in. A local answer is
   * too fast to interrupt usefully, but a caller that has just pressed Stop
   * should not then be handed a reply it asked not to receive.
   */
  async answerLocally(
    prompt: string,
    handlers: PlannerHandlers,
    {
      signal,
      preferences,
      knownStay,
    }: {
      signal?: AbortSignal;
      preferences?: TravelPreferences;
      /** What this conversation has already settled, if anything. */
      knownStay?: ConfirmedStay;
    } = {},
  ): Promise<void> {
    const { reply, trip, pendingStay } = await answerOffline(prompt, {
      proHint: PRO_HINT,
      preferences,
      /*
       * Asked once per trip, not once per conversation: naming a city is
       * asking for a new trip, and a new trip gets the question again.
       */
      stay: staySettledForPrompt(knownStay, prompt),
    });

    if (signal?.aborted) return;

    handlers.onText(reply);
    if (trip) handlers.onTrip(trip);
    if (pendingStay) handlers.onStayNeeded(pendingStay);
  },

  /**
   * Carrying on once the stay is settled.
   *
   * The turn that was interrupted, finished — and which turn that was is in
   * the `resume` the question was asked with. A free trip is the sentence
   * replayed, so everything it said about dates and party size still counts; a
   * Pro one is the constraints the model already produced, scheduled at last,
   * because running the model again would cost a second paid turn to be told
   * the same thing.
   *
   * `stay` is never `undefined` here. The reader has been asked, and both a
   * hotel and "there isn't one" are answers — passing `undefined` would ask
   * them again, which is the one outcome this whole flow exists to avoid.
   */
  async resume(
    resume: StayResume,
    stay: ResolvedStay | null,
    handlers: PlannerHandlers,
    {
      signal,
      preferences = DEFAULT_PREFERENCES,
    }: { signal?: AbortSignal; preferences?: TravelPreferences } = {},
  ): Promise<void> {
    // Named back, because the reader picked it off a list of near-identical
    // rows and this is the confirmation that the right one landed.
    if (stay) handlers.onText(`Planning around ${stay.name}. `);

    try {
      if (resume.kind === 'prompt') {
        const { reply, trip } = await answerOffline(resume.prompt, { preferences, stay });

        if (signal?.aborted) return;

        handlers.onText(reply);
        if (trip) handlers.onTrip(trip);
        return;
      }

      const trip = await tripForBrief(
        toTripBrief(resume.brief, preferences, stay),
        extrasOf(resume.brief),
      );

      if (signal?.aborted) return;

      handlers.onTrip(trip);
    } catch (caught) {
      if (caught instanceof NoPlacesInRangeError) {
        handlers.onText(caught.message);
        return;
      }

      throw caught;
    }
  },

  /**
   * The whole answer at once.
   *
   * The offline path, exposed for the seeded conversation and for anything that
   * cannot render a growing message. `chat` is what the planner screen uses.
   */
  generateItinerary(
    prompt: string,
    preferences?: TravelPreferences,
  ): Promise<GeneratedItinerary> {
    /*
     * `stay: null` rather than unasked. This answers in one shot for a caller
     * with no way to render a follow-up question, so asking one would hang the
     * trip on an answer that can never arrive. The radius is measured from the
     * middle of the city, which is what it did before the question existed.
     */
    return answerOffline(prompt, { preferences, stay: null });
  },
};
