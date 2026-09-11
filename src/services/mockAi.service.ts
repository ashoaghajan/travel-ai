import type {
  GeneratedItinerary,
  ResolvedStay,
  TravelPreferences,
  TripBrief,
} from '../types/planner.types';
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
import { DEFAULT_PREFERENCES, locationRulesApply, planItinerary } from './itinerary.planner';
import type { PlanningContext } from './itinerary.planner';
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

/**
 * Words that come before a place name without being part of it.
 *
 * Skipped while nothing has been collected yet, rather than treated as the end
 * of the name — which is the whole difference between this and
 * `NAME_ENDS_AT`. "A trip to the Hague" is a trip to the Hague, and stopping
 * at "the" would leave nothing at all.
 *
 * The planning words are here for the phrasing with no preposition in it at
 * all: "trip Tbilisi" and "plan Tbilisi for 5 days" are things people type,
 * and both begin with a word that ends a name anywhere *except* in front of
 * one. Checked before `NAME_ENDS_AT`, which is what lets the same word be
 * skipped here and fatal in the middle.
 *
 * **"new" is deliberately absent.** It reads like a lead-in — "a new trip to
 * Tbilisi" — but that phrasing has a preposition and never reaches here,
 * whereas New York, New Orleans and New Delhi all start with it and would
 * have arrived as York, Orleans and Delhi.
 */
const LEADS_A_NAME = new Set([
  'a',
  'an',
  'the',
  'my',
  'our',
  'another',
  'trip',
  'trips',
  'holiday',
  'vacation',
  'getaway',
  'plan',
  'planning',
  'book',
  'booking',
  'create',
  'make',
  'arrange',
  'organise',
  'organize',
]);

/**
 * Words that end a place name rather than continue it.
 *
 * These used to be *filtered out* of the captured phrase instead, and the
 * difference is not cosmetic. Filtering asks "is this word part of a name?" of
 * each word independently, so "to Tbilisi from 14 to 18 of September" captured
 * "Tbilisi from", dropped nothing, and searched the attractions directory for
 * a city called **"Tbilisi From"** — which does not exist, so the trip fell
 * back to a generic template with stock photographs and "Your destination" on
 * every card. Truncating asks the right question instead: once a word like
 * "from" appears, the name is over, and whatever follows belongs to the dates.
 *
 * The travel verbs are here for the other half of the same bug: "I want to go
 * to Tbilisi" matched at "to go" and produced "Go To". They end a name because
 * they can never be inside one, which lets the scan move on to the next "to"
 * and find the city.
 */
const NAME_ENDS_AT = new Set([
  // Prepositions and connectives that follow a destination.
  'from',
  'for',
  'in',
  'on',
  'at',
  'of',
  'by',
  'to',
  'with',
  'and',
  'or',
  'between',
  'during',
  'over',
  'around',
  'before',
  'after',
  'until',
  'till',
  'through',
  'next',
  'this',
  'starting',
  'departing',
  'returning',
  // Whose trip it is, never where it is.
  'my',
  'our',
  'we',
  'i',
  'me',
  'us',
  /*
   * Pronouns and the words a refinement opens with.
   *
   * These matter because of the bare-name fallback, which reads a short
   * prompt with no preposition in it as a place name: without them "make it 5
   * days" parsed as a trip to **It**, and a refinement that names a city is
   * treated as a request for a new trip — so the planner would have re-opened
   * a settled question and planned a trip to nowhere at the same time.
   *
   * Every one of these is checked against a map before it goes in. Split,
   * Nice and Bath are cities; "cheaper" and "instead" are not.
   */
  'it',
  'its',
  'that',
  'them',
  'they',
  'there',
  'here',
  'those',
  'these',
  'something',
  'anything',
  'nothing',
  'everything',
  'more',
  'less',
  'fewer',
  'cheaper',
  'later',
  'earlier',
  'longer',
  'shorter',
  'add',
  'remove',
  'drop',
  'change',
  'swap',
  'instead',
  'again',
  'also',
  'different',
  'better',
  // Verbs that sit between "to" and the place.
  'go',
  'going',
  'visit',
  'visiting',
  'travel',
  'travelling',
  'traveling',
  'see',
  'seeing',
  'fly',
  'flying',
  'head',
  'heading',
  'get',
  'getting',
  'stay',
  'staying',
  'explore',
  'exploring',
  'book',
  'booking',
  'plan',
  'planning',
  'spend',
  'spending',
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
 * The most words a place name may run to.
 *
 * Three rather than two, now that `NAME_ENDS_AT` does the real work of
 * knowing where a name stops: the cap is a backstop against a run-on sentence
 * rather than the thing deciding where "New York for four people" ends. Two
 * could not spell Rio de Janeiro or Ho Chi Minh City.
 */
const MAX_NAME_WORDS = 3;

/**
 * The words that announce a destination — and *only* those words.
 *
 * Deliberately not `to\s+(name)`: a capture that took the name too would also
 * consume everything up to the end of it, and `matchAll` resumes after a whole
 * match. "I want to go to Tbilisi" matched once, at "to go to Tbilisi",
 * swallowed the second "to" along with it, and left nothing for the scan to
 * try — which is how that sentence became a trip to "Go To". Matching the
 * opener alone means each "to" in a sentence gets its own turn.
 *
 * `into` leads the alternation, and that ordering is load-bearing: regex
 * alternation is left-to-right at each position, so `in|into` matches the "in"
 * of "into", fails on the space that is not there, and abandons the position.
 * "Create a new trip **into** Tbilisi" found no destination at all before
 * this, and produced a template itinerary labelled "Your destination".
 *
 * `visit` is here because `intent.ts` already counts it as a request to plan
 * something. A classifier that says "this is a trip request" beside a parser
 * that cannot say where to is a contradiction, and it surfaces as a generic
 * trip for a sentence that named a city plainly.
 */
const DESTINATION_OPENERS = /\b(?:into|in|to|towards|toward|visiting|visit)\s+/gi;

/**
 * Words that are never part of a place name, however place-shaped they look.
 *
 * Two groups, and both exist because the intent classifier is deliberately
 * eager: "hello", "thanks" and "ok" are all read as trip requests, so without
 * this the bare-name fallback below would happily plan a trip to Hello and ask
 * which hotel somebody is staying at in it.
 *
 * The vague destinations are the other group. "Somewhere warm" is a real thing
 * to type and a real thing to answer, but it is not a name the attractions
 * directory can be searched for — the templates handle it, and they should
 * keep handling it.
 *
 * Kept deliberately short, and checked against real cities before adding to:
 * Nice, Bath and Split are all places, so an adjective-sounding word is not
 * on its own a reason to be here.
 */
const NOT_A_PLACE = new Set([
  // Vague destinations.
  'somewhere',
  'anywhere',
  'everywhere',
  'nowhere',
  'abroad',
  'overseas',
  'home',
  'beach',
  'beaches',
  'mountains',
  'seaside',
  'coast',
  'countryside',
  'island',
  'warm',
  'cold',
  'sunny',
  'cheap',
  'expensive',
  /*
   * How a question opens. `intent.ts` catches most of these before the parser
   * is ever reached, but not all — it is eager, and "what a lovely day" is
   * read as a trip request. None of them is ever inside a place name either,
   * so this costs nothing and closes the gap from the other side.
   */
  'what',
  'whats',
  'when',
  'where',
  'why',
  'how',
  'who',
  'which',
  'tell',
  'show',
  'give',
  'find',
  'recommend',
  'suggest',
  'should',
  'could',
  'would',
  'will',
  'does',
  'did',
  'is',
  'are',
  'am',
  'was',
  'were',
  // Conversation, not geography.
  'hello',
  'hi',
  'hey',
  'thanks',
  'thank',
  'please',
  'yes',
  'yeah',
  'no',
  'nope',
  'ok',
  'okay',
  'sure',
  'maybe',
  'help',
  'trip',
  'holiday',
  'vacation',
  'getaway',
]);

/** Only a word can be part of a place name — "18" ends one. */
const NAME_WORD = /^[A-Za-z][A-Za-z'’-]*$/;

/**
 * Punctuation around a word, which is not part of it.
 *
 * "Tbilisi, 14-18 September" is a perfectly ordinary way to ask, and the comma
 * alone was enough to make the name fail `NAME_WORD` and yield nothing at all.
 * Only the outside is trimmed — Stratford-upon-Avon keeps its hyphens.
 */
function bareWord(word: string): string {
  return word.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
}

/** The place name at the start of this text, or null if there is not one. */
function nameWithin(text: string): string | null {
  const words: string[] = [];

  for (const raw of text.split(/\s+/)) {
    const word = bareWord(raw);
    if (word === '') continue;

    const lower = word.toLowerCase();

    // Only ever a lead-in; inside a name the same word ends it.
    if (words.length === 0 && LEADS_A_NAME.has(lower)) continue;
    if (
      !NAME_WORD.test(word) ||
      NAME_ENDS_AT.has(lower) ||
      MONTH_WORDS.has(lower) ||
      NOT_A_PLACE.has(lower)
    ) {
      break;
    }

    words.push(word);
    if (words.length === MAX_NAME_WORDS) break;
  }

  return words.length > 0 ? titleCase(words.join(' ')) : null;
}

/**
 * Pulls the place out of "…trip to Lisbon for…" or "…a weekend in Porto…"
 * when no template matches.
 *
 * **Every opener is tried, not just the first.** A sentence says "to" more
 * than once — "I want to go to Tbilisi", "from 14 to 18" — and the first
 * occurrence is usually not the one carrying the destination. An opener that
 * yields no name simply moves the scan along to the next.
 */
function parseDestinationName(prompt: string): string | null {
  // A fresh regex per call: a shared global one carries `lastIndex` between
  // calls, so every second prompt would start reading from the middle.
  for (const match of prompt.matchAll(new RegExp(DESTINATION_OPENERS))) {
    const name = nameWithin(prompt.slice(match.index + match[0].length));
    if (name) return name;
  }

  return bareDestination(prompt);
}

/**
 * How long a prompt may be and still be read as nothing but a place name.
 *
 * A sentence with no "to", "in" or "into" anywhere in it is usually not naming
 * a destination, so the fallback stays near what somebody actually types when
 * they are naming one: "Tbilisi", "Rio de Janeiro", "Tbilisi, 14-18 September",
 * "plan Tbilisi for 5 days".
 *
 * Six rather than the four this started at, because the terminators do the
 * real work now — a question opener, a vague destination or a connective ends
 * the name wherever it appears, so the cap is a backstop against a long
 * descriptive sentence rather than the thing keeping nonsense out.
 */
const MAX_BARE_PROMPT_WORDS = 6;

/**
 * The whole prompt read as a place name — "Tbilisi" and nothing else.
 *
 * The last resort, and it closes a real gap rather than guessing: `intent.ts`
 * calls a bare city a trip request and always has, but nothing could then say
 * *which* city, so "Tbilisi" produced the generic template — a trip to "Your
 * destination", with stock photographs. It also left the stay question
 * unanchored: with no destination, the hotel lookup is not bounded to a city,
 * and "Grand Hotel" could be matched anywhere on earth.
 *
 * A wrong guess here is cheap and self-correcting: the name goes to the
 * attractions directory, finds nothing, and the trip falls back to the
 * template it would have got anyway. `NOT_A_PLACE` is what keeps the guess
 * from being *visibly* wrong, in a question naming a city that is not one.
 */
function bareDestination(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (trimmed === '' || trimmed.split(/\s+/).length > MAX_BARE_PROMPT_WORDS) return null;

  return nameWithin(trimmed);
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
 * The two location rules left nothing to plan.
 *
 * Its own error because it is the one empty result that must **not** become a
 * template trip. Every other reason the scheduler comes back with nothing —
 * no network, a destination the catalogue has never heard of, a prompt naming
 * no place — is answered by the templates, and a generic week is a better
 * answer than an apology.
 *
 * This one is the opposite. The templates honour no preference at all, so
 * handing one to somebody who asked for "within 1 km of my hotel" answers the
 * question with seven days of places that are not, and does it silently. The
 * message is written for the chat, and names the setting to change, because
 * the preference that caused this is on a screen the reader is not looking at.
 */
export class NoPlacesInRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoPlacesInRangeError';
  }
}

/** How the radius describes the point it was measured from. */
function baseLabel(base: PlanningContext['base'], destination: string): string {
  if (base?.source === 'named' || base?.source === 'stay') return 'your hotel';

  return `the middle of ${destination}`;
}

/**
 * Why nothing survived, in the reader's own terms.
 *
 * Both rules are named when both were in force, because there is no way to
 * tell from here which of them did the excluding and guessing would send
 * somebody to change the wrong setting.
 */
function outOfRangeMessage(brief: TripBrief, context: PlanningContext): string {
  const limit = brief.preferences.maxDistanceFromHotelKm;
  const reasons: string[] = [];

  if (limit !== null && context.base) {
    reasons.push(`within ${limit} km of ${baseLabel(context.base, brief.destination)}`);
  }

  if (brief.preferences.nearMetroOnly && (context.metroStations?.length ?? 0) > 0) {
    reasons.push('within a short walk of a metro station');
  }

  return (
    `I could not find enough to do in ${brief.destination} ${reasons.join(' and ')}. ` +
    'Widen it in Settings → Planning, or tell me a different hotel, and I will try again.'
  );
}

/**
 * A scheduled trip, or null when this destination cannot be scheduled.
 *
 * Null covers most reasons at once on purpose: no key, no network, a place the
 * catalogue has never heard of, or a set of preferences that rules out
 * everything it does have. The caller does the same thing in all four cases —
 * falls back to a template — and distinguishing them here would only produce a
 * distinction it then had to discard.
 *
 * The exception is `NoPlacesInRangeError`, thrown rather than returned, and
 * the reason it is not null is that the caller must **not** do the usual thing
 * with it. See the class.
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
  const context = await resolvePlanningContext(brief);
  const itinerary = planItinerary(brief, pool, context);

  // A trip whose days are all empty is not a trip either. It happens when the
  // pool holds a handful of rows and every one of them is in a category the
  // reader ruled out — the templates say more than a week of blank days would.
  if (itinerary.length === 0 || itinerary.every((day) => day.activities.length === 0)) {
    /*
     * Unless a location rule was doing the excluding, and there was something
     * to exclude. A catalogue that came back empty is not evidence about a
     * radius, so it takes the template path like any other empty pool.
     */
    if (pool.length > 0 && locationRulesApply(brief.preferences, context)) {
      throw new NoPlacesInRangeError(outOfRangeMessage(brief, context));
    }

    return null;
  }

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

/**
 * The place a prompt is about, or null.
 *
 * Exported for one caller: the stay question has to name the city it is asking
 * about, and it is asked *before* anything is planned — so it cannot read the
 * destination off a trip that does not exist yet. Same parse the planner is
 * about to run, rather than a second one that could disagree with it.
 */
export function destinationNameIn(prompt: string): string | null {
  return resolveDestination(prompt).name;
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
    stay?: ResolvedStay | null,
  ): Promise<GeneratedItinerary> {
    const { template, name } = resolveDestination(prompt);
    const { startDate, days } = resolveSchedule(prompt);
    const travellers = parseTravellers(prompt);

    /*
     * Only a named destination can be scheduled: the pool is fetched by name,
     * and "somewhere warm" is not a name. That prompt still gets the generic
     * template, which is what it got before.
     */
    let scheduled: TripDraft | null;

    try {
      scheduled = name
        ? await planFromRealPlaces(
            {
              destination: name,
              startDate: toIsoDate(startDate),
              days,
              travellers,
              /*
               * The stay the reader confirmed, when they were asked. Absent
               * when the radius is off and nobody was asked, and null when
               * they were and said there is not one — both of which leave the
               * radius measured from the middle of the city.
               */
              hotelName: stay?.name,
              hotelLocation: stay?.coordinates,
              preferences,
            },
            template,
          )
        : null;
    } catch (caught) {
      /*
       * The one empty result that gets a sentence rather than a template.
       *
       * Answered here rather than thrown on, because a rule the reader
       * switched on themselves excluding everything is a fact about their
       * settings, not a failure of the planner — an error banner would be the
       * wrong shape for it. No trip goes with it: there is honestly not one.
       */
      if (caught instanceof NoPlacesInRangeError) return { reply: caught.message };
      throw caught;
    }

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
