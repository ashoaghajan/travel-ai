import type { GeneratedItinerary, TravelPreferences, TripBrief } from '../types/planner.types';
import type { ItineraryActivity, ItineraryDay, TripDraft } from '../types/trip.types';
import {
  DESTINATION_TEMPLATES,
  GENERIC_DESTINATION,
  type DayTemplate,
  type DestinationTemplate,
} from '../mock/destinations';
import type { Activity } from '../types/travel.types';
import { addDays, findDates, findMonthStart, fromIsoDate, toIsoDate } from '../utils/date';
import { createId } from '../utils/id';
import { coverImage } from '../utils/itineraryImages';
import { activityService } from './activity.service';
import { DEFAULT_PREFERENCES, planItinerary } from './itinerary.planner';
import { resolvePlanningContext } from './planning.context';

/**
 * The planner that needs no model.
 *
 * It reads a few things out of the prompt — destination, length, party size,
 * month — and then builds the days two ways, in this order:
 *
 * 1. **From real places.** `activity.service` supplies the same pool the
 *    explorer browses, and `itinerary.planner` schedules it against the
 *    reader's own preferences: their hours, the categories they want, what
 *    they will spend on one activity and on one day. Nothing about those days
 *    is written in advance, so this is where a precise, personal trip comes
 *    from.
 *
 * 2. **From the templates**, when the first cannot answer — no attraction key
 *    on the server, an unreachable provider, a destination the catalogue has
 *    nothing for, or preferences so narrow that nothing survives them. The
 *    templates in `mock/destinations.ts` are unchanged and still produce a
 *    real trip; they are simply no longer the only thing this module can do.
 *
 * The fallback is the reason this module did not become a thin wrapper. A
 * planner that returns nothing when a provider is down is worse than one that
 * returns a generic week, and somebody typing into the chat has asked for a
 * trip rather than for an explanation of why there is not one.
 */

/** Deliberate delay so the UI's loading state is exercised (DESIGN_SPEC rule 17). */
const GENERATION_DELAY_MS = 1100;

const DEFAULT_DAYS = 5;
const MAX_DAYS = 14;
const DEFAULT_TRAVELLERS = 2;
const MAX_TRAVELLERS = 12;
/** Booked far enough out to be plausible when the prompt names no month. */
const DEFAULT_LEAD_DAYS = 30;

/** DESIGN_SPEC Screen 8 cost example: $2,248 flights for 2, $1,260 for 7 nights. */
const FLIGHT_PRICE_PER_TRAVELLER = 1124;
const HOTEL_PRICE_PER_NIGHT = 180;

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'in',
  'on',
  'with',
  'and',
  'next',
  'this',
  'during',
  'over',
  'my',
  'our',
  'we',
  'i',
]);

const MONTH_WORDS = new Set([
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'spring',
  'summer',
  'autumn',
  'winter',
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};

function toNumber(value: string): number | null {
  const parsed = WORD_NUMBERS[value.toLowerCase()] ?? Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDays(prompt: string): number {
  const dayMatch = prompt.match(/(\d+)\s*-?\s*(?:day|days|night|nights)\b/i);
  if (dayMatch) {
    const days = toNumber(dayMatch[1]);
    if (days !== null) return clamp(days, 1, MAX_DAYS);
  }

  const weekMatch = prompt.match(/\b(\d+|a|an|one|two|three|four)\s*-?\s*weeks?\b/i);
  if (weekMatch) {
    const weeks = toNumber(weekMatch[1]);
    if (weeks !== null) return clamp(weeks * 7, 1, MAX_DAYS);
  }

  if (/\bweekend\b/i.test(prompt)) return 3;

  return DEFAULT_DAYS;
}

function parseTravellers(prompt: string): number {
  const lower = prompt.toLowerCase();

  const match = lower.match(/(\d+)\s*(?:adults?|travellers?|travelers?|people|guests?|of us)\b/);
  if (match) {
    const travellers = Number.parseInt(match[1], 10);
    if (Number.isFinite(travellers)) return clamp(travellers, 1, MAX_TRAVELLERS);
  }

  if (/\b(?:solo|alone|by myself|just me)\b/.test(lower)) return 1;
  if (/\b(?:couple|honeymoon|partner|two of us)\b/.test(lower)) return 2;
  if (/\bfamily\b/.test(lower)) return 4;

  return DEFAULT_TRAVELLERS;
}

function matchTemplate(prompt: string): DestinationTemplate | null {
  const lower = prompt.toLowerCase();
  return (
    DESTINATION_TEMPLATES.find((template) =>
      template.keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(lower)),
    ) ?? null
  );
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Pulls the place out of "…trip to Lisbon for…" or "…a weekend in Porto…"
 * when no template matches. Month names are filtered out so "in June" is not
 * mistaken for a destination.
 */
function parseDestinationName(prompt: string): string | null {
  const patterns = [
    /\bto\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/,
    /\bin\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;

    const words = match[1]
      .split(/\s+/)
      .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
      .filter((word) => !MONTH_WORDS.has(word.toLowerCase()));

    if (words.length > 0) return titleCase(words.slice(0, 2).join(' '));
  }

  return null;
}

/** `name` is null when the prompt never says where the user wants to go. */
function resolveDestination(prompt: string): {
  template: DestinationTemplate;
  name: string | null;
} {
  const template = matchTemplate(prompt);
  if (template) return { template, name: template.name };

  return { template: GENERIC_DESTINATION, name: parseDestinationName(prompt) };
}

/**
 * When the trip starts and how long it runs.
 *
 * Three sources, in the order that respects what was actually said:
 *
 * 1. **Dates in the sentence.** "from 14 to 18 September" is a start *and* a
 *    length, and both come from here. This used to be missed entirely — the
 *    parser knew months and not dates, so that sentence produced the first of
 *    September for five days: the right length, in the wrong week, for a trip
 *    somebody had stated exactly.
 * 2. **A month.** "a week in June" still means the first of June, which is the
 *    honest reading of a month with no day in it.
 * 3. **A default.** Far enough out to be bookable.
 *
 * A stated range beats a stated length when they disagree — "a 3-day trip from
 * 14 to 18 September" is five days, because the dates are the specific claim
 * and the length is the round one.
 */
function resolveSchedule(prompt: string): { startDate: Date; days: number } {
  const spoken = parseDays(prompt);
  const dates = findDates(prompt);

  if (dates) {
    return {
      startDate: dates.start,
      days: dates.days === null ? spoken : clamp(dates.days, 1, MAX_DAYS),
    };
  }

  return {
    startDate: findMonthStart(prompt) ?? addDays(new Date(), DEFAULT_LEAD_DAYS),
    days: spoken,
  };
}

/** Body days cycle; the last day is always the departure template. */
function selectDayTemplates(template: DestinationTemplate, days: number): DayTemplate[] {
  if (days === 1) return [template.days[0]];

  const body = Array.from(
    { length: days - 1 },
    (_, index) => template.days[index % template.days.length],
  );
  return [...body, template.departure];
}

function toActivity(activity: DayTemplate['activities'][number]): ItineraryActivity {
  return { ...activity, id: createId('activity') };
}

function toDay(
  dayTemplate: DayTemplate,
  index: number,
  startDate: Date,
  destinationName: string,
): ItineraryDay {
  return {
    id: createId('day'),
    dayNumber: index + 1,
    date: toIsoDate(addDays(startDate, index)),
    destination: dayTemplate.destination || destinationName,
    summary: dayTemplate.summary,
    image: dayTemplate.image,
    activities: dayTemplate.activities.map(toActivity),
  };
}

function sumActivityPrices(itinerary: ItineraryDay[]): number {
  return itinerary.reduce(
    (total, day) =>
      total + day.activities.reduce((dayTotal, a) => dayTotal + (a.priceEstimate ?? 0), 0),
    0,
  );
}

export type BuildTripOptions = {
  template: DestinationTemplate;
  destinationName: string;
  days: number;
  travellers: number;
  startDate: Date;
  title?: string;
  /**
   * Stable identity for this draft. Pass a fixed value for seeded content so
   * it keeps the same identity across reloads; generated drafts get a new one.
   */
  draftId?: string;
};

/**
 * Assembles a trip draft from a template. Exported so the seeded conversation
 * on the planner uses exactly the same builder as a live "generation".
 */
export function buildTripDraft({
  template,
  destinationName,
  days,
  travellers,
  startDate,
  title,
  draftId,
}: BuildTripOptions): TripDraft {
  const itinerary = selectDayTemplates(template, days).map((dayTemplate, index) =>
    toDay(dayTemplate, index, startDate, destinationName),
  );
  const nights = Math.max(0, days - 1);

  return {
    draftId: draftId ?? createId('draft'),
    title:
      title ??
      (template === GENERIC_DESTINATION ? `${destinationName} Trip` : template.tripTitle),
    destination: destinationName,
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(addDays(startDate, Math.max(0, days - 1))),
    travellers,
    coverImage: template.coverImage,
    itinerary,
    flightsEstimate: FLIGHT_PRICE_PER_TRAVELLER * travellers,
    hotelsEstimate: HOTEL_PRICE_PER_NIGHT * nights,
    activitiesEstimate: sumActivityPrices(itinerary) * travellers,
  };
}

/** How many places to pull for a trip — more than the longest trip can use. */
const POOL_SIZE = 80;

/**
 * A scheduled trip, or null when this destination cannot be scheduled.
 *
 * Null covers every reason at once on purpose: no key, no network, a place the
 * catalogue has never heard of, or a set of preferences that rules out
 * everything it does have. The caller does the same thing in all four cases —
 * falls back to a template — and distinguishing them here would only produce a
 * distinction it then had to discard.
 */
async function planFromRealPlaces(
  brief: TripBrief,
  template: DestinationTemplate,
  extras: TripExtras = {},
): Promise<TripDraft | null> {
  let pool: Activity[];

  try {
    const result = await activityService.getActivities({
      destination: brief.destination,
      limit: POOL_SIZE,
    });
    pool = result.activities;
  } catch {
    return null;
  }

  /*
   * The two location rules need looking up before the scheduler can apply
   * them — where the trip is based, and where the metro stops. Both are no-ops
   * and cost nothing when their preference is off, which is the default.
   */
  const itinerary = planItinerary(brief, pool, await resolvePlanningContext(brief));
  if (itinerary.length === 0) return null;

  // A trip whose days are all empty is not a trip. It happens when the pool
  // holds a handful of rows and every one of them is in a category the reader
  // ruled out — the templates say more than a week of blank days would.
  if (itinerary.every((day) => day.activities.length === 0)) return null;

  const categories = itinerary.flatMap((day) => day.activities.map((entry) => entry.category));
  const nights = Math.max(0, brief.days - 1);
  const startDate = fromIsoDate(brief.startDate);

  return {
    draftId: createId('draft'),
    title: extras.title?.trim() || `${brief.destination} Trip`,
    destination: brief.destination,
    destinationCity: extras.destinationCity,
    destinationCountry: extras.destinationCountry,
    startDate: brief.startDate,
    endDate: toIsoDate(addDays(startDate, nights)),
    travellers: brief.travellers,
    // The template's cover only fits when the template is what was built; a
    // scheduled trip is described by what is actually in it.
    coverImage: categories.length > 0 ? coverImage(categories) : template.coverImage,
    itinerary,
    /*
     * The model's estimates when there are any, this app's constants when
     * there are not.
     *
     * These are the one part of a trip a model is still better at: it knows
     * roughly what a March flight to Osaka costs, where the constant below
     * charges the same for every destination on earth. The days themselves are
     * never taken from it.
     */
    flightsEstimate: extras.flightsEstimate ?? FLIGHT_PRICE_PER_TRAVELLER * brief.travellers,
    hotelsEstimate: extras.hotelsEstimate ?? HOTEL_PRICE_PER_NIGHT * nights,
    activitiesEstimate: sumActivityPrices(itinerary) * brief.travellers,
  };
}

/**
 * What a caller knows about a trip that the scheduler cannot work out.
 *
 * All optional, all from the model: a title with some character in it, the
 * city and country the explorer and the flight search need, and the two
 * whole-trip estimates. A free trip has none of them and is a trip regardless.
 */
export type TripExtras = {
  title?: string;
  destinationCity?: string;
  destinationCountry?: string;
  flightsEstimate?: number;
  hotelsEstimate?: number;
};

/**
 * A trip for a brief, scheduled if it can be and templated if it cannot.
 *
 * The one entry point both engines use. A free account reaches it through
 * `generateItinerary` with a brief parsed out of a sentence; a Pro account
 * reaches it from `planner.service` with a brief the model filled in. What
 * happens after that point is identical, which is the whole design: the days
 * are the scheduler's either way, and the model's contribution is knowing what
 * to ask for and what to say about it.
 */
export async function tripForBrief(brief: TripBrief, extras: TripExtras = {}): Promise<TripDraft> {
  const { template } = resolveDestination(brief.destination);

  return (
    (await planFromRealPlaces(brief, template, extras)) ??
    buildTripDraft({
      template,
      destinationName: brief.destination,
      days: brief.days,
      travellers: brief.travellers,
      startDate: fromIsoDate(brief.startDate),
      title: extras.title,
    })
  );
}

export const mockAiService = {
  /**
   * `preferences` is how the days become somebody's rather than anybody's.
   *
   * Optional, and defaulted, because this must answer for a reader who has
   * never opened the settings screen — and because the planner screens call it
   * before the account's own preferences have necessarily loaded.
   */
  async generateItinerary(
    prompt: string,
    preferences: TravelPreferences = DEFAULT_PREFERENCES,
  ): Promise<GeneratedItinerary> {
    const { template, name } = resolveDestination(prompt);
    const { startDate, days } = resolveSchedule(prompt);
    const travellers = parseTravellers(prompt);

    /*
     * Only a named destination can be scheduled: the pool is fetched by name,
     * and "somewhere warm" is not a name. That prompt still gets the generic
     * template, which is what it got before.
     */
    const scheduled = name
      ? await planFromRealPlaces(
          {
            destination: name,
            startDate: toIsoDate(startDate),
            days,
            travellers,
            preferences,
          },
          template,
        )
      : null;

    /*
     * The delay is only for the template path now.
     *
     * It exists so the loading state is exercised (DESIGN_SPEC rule 17), and a
     * real search already takes longer than it. Adding it on top would be a
     * second of nothing on every generated trip, spent proving a spinner that
     * the network had already proved.
     */
    if (!scheduled) await delay(GENERATION_DELAY_MS);

    const trip =
      scheduled ??
      buildTripDraft({
        template,
        // Falls back to a neutral label when the prompt names no place.
        destinationName: name ?? GENERIC_DESTINATION.name,
        days,
        travellers,
        startDate,
        title: name === null ? 'Your Next Trip' : undefined,
      });

    return {
      reply: name
        ? `Sure! Here's a ${days}-day ${name} itinerary crafted for you:`
        : `Sure! Here's a ${days}-day itinerary to get you started — tell me where you'd like to go and I'll tailor it:`,
      trip,
    };
  },
};
