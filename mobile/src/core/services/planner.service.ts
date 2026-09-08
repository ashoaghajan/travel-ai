import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerChatMessage, PlannerStreamEvent, PlannerTripBrief } from '@ai-travel/shared';
import type { GeneratedItinerary, TravelPreferences, TripBrief } from '../types/planner.types';
import type { ActivityCategory, TripDraft } from '../types/trip.types';
import { classifyPrompt } from '../utils/intent';
import { ApiError, stream } from './http';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { mockAiService, tripForBrief } from './mockAi.service';
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
function toTripBrief(brief: PlannerTripBrief, base: TravelPreferences): TripBrief {
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
    preferences: {
      ...base,
      ...overrides,
      categoryWeights,
      meals: { ...base.meals, ...overrides.meals },
    },
  };
}

export type PlannerHandlers = {
  /** One chunk of the reply. Append it — do not replace what came before. */
  onText: (text: string) => void;
  /** The model proposed a trip. At most once per message. */
  onTrip: (trip: TripDraft) => void;
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
  { proHint = '', preferences }: { proHint?: string; preferences?: TravelPreferences } = {},
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
    default:
      return withDestinationFacts(await mockAiService.generateItinerary(prompt, preferences));
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
    }: { signal?: AbortSignal; preferences?: TravelPreferences } = {},
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
            scheduling = tripForBrief(toTripBrief(event.brief, preferences), {
              title: event.brief.title,
              // Straight from the model, and the reason this path needs no
              // geocoding: it named the city and the country itself.
              destinationCity: event.brief.destinationCity,
              destinationCountry: event.brief.destinationCountry,
              flightsEstimate: event.brief.flightsEstimate,
              hotelsEstimate: event.brief.hotelsEstimate,
            });
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

      // After the words, because that is the order it happens in: the model
      // calls the tool, talks about the trip, and the card lands under it.
      if (scheduling) handlers.onTrip(await scheduling);
    } catch (caught) {
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

      const { reply, trip } = await answerOffline(prompt);
      handlers.onText(reply);
      if (trip) handlers.onTrip(trip);
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
    }: { signal?: AbortSignal; preferences?: TravelPreferences } = {},
  ): Promise<void> {
    const { reply, trip } = await answerOffline(prompt, { proHint: PRO_HINT, preferences });

    if (signal?.aborted) return;

    handlers.onText(reply);
    if (trip) handlers.onTrip(trip);
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
    return answerOffline(prompt, { preferences });
  },
};
