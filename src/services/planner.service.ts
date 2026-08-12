import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerChatMessage, PlannerItineraryPlan, PlannerStreamEvent } from '@ai-travel/shared';
import type { GeneratedItinerary } from '../types/planner.types';
import type { ActivityCategory, ItineraryDay, TripDraft } from '../types/trip.types';
import { classifyPrompt } from '../utils/intent';
import { addDays, toIsoDate } from '../utils/date';
import { createId } from '../utils/id';
import { coverImage, dayImage } from '../utils/itineraryImages';
import { ApiError, stream } from './http';
import { mockAiService } from './mockAi.service';
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

async function answerWeather(place: string | null): Promise<GeneratedItinerary> {
  if (!place) return { reply: NO_PLACE };

  try {
    const report = await weatherService.getWeather(place);
    const where = report.country ? `${report.place}, ${report.country}` : report.place;

    return {
      reply: `It's ${report.temperature}°C and ${report.description} in ${where} right now, with a high of ${report.high}°C and a low of ${report.low}°C today. ${OFFER_TRIP}`,
    };
  } catch (error) {
    if (error instanceof PlaceNotFoundError) {
      return { reply: `I could not find a place called “${place}”. ${OFFER_TRIP}` };
    }
    return { reply: weatherUnavailable(place) };
  }
}

async function answerLocation(place: string | null): Promise<GeneratedItinerary> {
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
      return { reply: `I could not find a place called “${place}”. ${OFFER_TRIP}` };
    }
    return { reply: weatherUnavailable(place) };
  }
}

/* ------------------------------------------------------- the model's answer */

/** Whole days between two ISO dates, inclusive of both ends. */
function spanInDays(startDate: string, endDate: string): number {
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const to = Date.parse(`${endDate}T00:00:00Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) return 1;

  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
}

function toDay(
  day: PlannerItineraryPlan['days'][number],
  index: number,
  startDate: Date,
): ItineraryDay {
  const activities = day.activities.map((activity) => ({
    id: createId('activity'),
    time: activity.time,
    title: activity.title,
    description: activity.description,
    category: activity.category,
    priceEstimate: activity.priceEstimate,
  }));

  return {
    id: createId('day'),
    dayNumber: index + 1,
    // Derived from the start date rather than trusted from the model: the days
    // are an ordered list, and a plan whose dates skipped one would put a gap
    // in the timeline for no reason a reader could see.
    date: toIsoDate(addDays(startDate, index)),
    destination: day.destination,
    summary: day.summary,
    image: dayImage(activities.map((activity) => activity.category)),
    activities,
  };
}

function sumActivityPrices(itinerary: ItineraryDay[]): number {
  return itinerary.reduce(
    (total, day) =>
      total + day.activities.reduce((dayTotal, a) => dayTotal + (a.priceEstimate ?? 0), 0),
    0,
  );
}

/**
 * The model's plan, as a draft the rest of the app already understands.
 *
 * Ids and photographs are added here rather than asked for: `createId` is the
 * client's, and the images are Vite-bundled assets the server cannot name. That
 * split is the whole reason the endpoint returns a plan instead of a `TripDraft`.
 */
export function toTripDraft(plan: PlannerItineraryPlan): TripDraft {
  const startDate = new Date(`${plan.startDate}T00:00:00`);
  const days = spanInDays(plan.startDate, plan.endDate);
  const itinerary = plan.days.map((day, index) => toDay(day, index, startDate));

  const categories: ActivityCategory[] = itinerary.flatMap((day) =>
    day.activities.map((activity) => activity.category),
  );

  return {
    draftId: createId('draft'),
    title: plan.title,
    destination: plan.destination,
    destinationCity: plan.destinationCity,
    destinationCountry: plan.destinationCountry,
    startDate: plan.startDate,
    // The model's own end date is only used when it agrees with the days it
    // actually wrote; otherwise the itinerary is the truth.
    endDate:
      itinerary.length === days ? plan.endDate : toIsoDate(addDays(startDate, itinerary.length - 1)),
    travellers: plan.travellers,
    coverImage: coverImage(categories),
    itinerary,
    flightsEstimate: plan.flightsEstimate,
    hotelsEstimate: plan.hotelsEstimate,
    activitiesEstimate: sumActivityPrices(itinerary) * plan.travellers,
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
async function answerOffline(prompt: string): Promise<GeneratedItinerary> {
  const intent = classifyPrompt(prompt);

  switch (intent.kind) {
    case 'weather':
      return answerWeather(intent.place);
    case 'location':
      return answerLocation(intent.place);
    case 'unknown':
      return { reply: CANNOT_ANSWER };
    case 'trip':
    default:
      return mockAiService.generateItinerary(prompt);
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
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const prompt = history.at(-1)?.content ?? '';
    let started = false;

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
          case 'itinerary':
            started = true;
            handlers.onTrip(toTripDraft(event.plan));
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
   * The whole answer at once.
   *
   * The offline path, exposed for the seeded conversation and for anything that
   * cannot render a growing message. `chat` is what the planner screen uses.
   */
  generateItinerary(prompt: string): Promise<GeneratedItinerary> {
    return answerOffline(prompt);
  },
};
