import type { TravelPreferences, TripBrief } from '../types/planner.types';
import type { Activity } from '../types/travel.types';
import type { ActivityCategory, ItineraryActivity, ItineraryDay, LatLng } from '../types/trip.types';
import { addDays, fromIsoDate, toIsoDate } from '../utils/date';
import { createId } from '../utils/id';
import { dayImage } from '../utils/itineraryImages';
import { minutesOf, toItineraryActivity } from './trip.service';

/**
 * The itinerary scheduler — days built from real places, against constraints.
 *
 * This is what `mockAi.service.ts` could never be. That module fills in a
 * template: the times, the activities and the prices are written into
 * `mock/destinations.ts`, so it never *chooses* an activity, and a preference
 * has nothing to apply to. Bali day two is the same day for everybody who
 * asks for it, at the same hours, at the same price.
 *
 * Here the raw material is `Activity[]` — the explorer's own pool, which is
 * OpenTripMap through `activity.service` — and the output is chosen: scored
 * against what somebody said they like, packed into a timeline that respects
 * the hours they keep, and stopped at the budget they set.
 *
 * **No model is involved, and that is the point rather than a limitation.** A
 * scheduler cannot invent a museum that does not exist, cannot put two things
 * at 14:00, and cannot quietly exceed a budget — three things a language model
 * does, and the reason the plan for this engine puts it in front of the model
 * rather than behind it. What a model is better at is prose and unusual
 * requests, which is why the seam it fills is `TripBrief` (a paragraph becomes
 * constraints) and the reply text, never the days themselves.
 *
 * Everything here is pure and deterministic apart from the ids: the same brief
 * and the same pool give the same days, in the same order, at the same times.
 * That is what makes it testable, and it is why the network call that fetches
 * the pool lives in the caller rather than in here.
 */

/* ------------------------------------------------------------------ defaults */

/**
 * What the planner assumes about somebody who has never said.
 *
 * A tourist's day, honestly: out by half nine, nothing new started after six,
 * three things in a day, both meals held open. The category weights are level
 * rather than zero — an untouched preference must not read as "no thank you",
 * which is exactly what a zero means here.
 */
export const DEFAULT_PREFERENCES: TravelPreferences = {
  dayStart: '09:30',
  dayEnd: '18:00',
  pace: 'balanced',
  categoryWeights: {
    food: 0.5,
    nature: 0.5,
    culture: 0.5,
    adventure: 0.5,
    relaxation: 0.5,
    // Not a thing anybody browses for; it exists on the union for transfers
    // and departure days, and no pool row is ever categorised as one.
    travel: 0,
  },
  maxActivityPrice: null,
  dailyActivityBudget: null,
  meals: { lunch: true, dinner: true },
};

/** Sightseeing stops per day, meals excluded — they are held open separately. */
const PACE_STOPS: Record<TravelPreferences['pace'], number> = {
  relaxed: 2,
  balanced: 3,
  packed: 5,
};

/**
 * How long each kind of thing takes, in minutes.
 *
 * Coarse on purpose. OpenTripMap does not publish visit durations, so a
 * per-place figure would be a fabrication with a decimal point on it; the
 * category average is a guess that admits what it is. It only has to be good
 * enough to stop the day being over-packed, and at this granularity it is.
 */
const CATEGORY_MINUTES: Record<ActivityCategory, number> = {
  food: 75,
  nature: 150,
  culture: 90,
  adventure: 180,
  relaxation: 120,
  travel: 60,
};

/** Rough door-to-door speed across a city, mixing walking and transit. */
const TRAVEL_SPEED_KMH = 22;
/** Nothing in a city is nearer than this once you have found the door. */
const MIN_TRAVEL_MINUTES = 10;
/**
 * Assumed when either end has no coordinates.
 *
 * Rows without a position exist — OpenTripMap has them — and treating that as
 * "no travel at all" would pack a day tighter for having *less* information,
 * which is the wrong direction to fail in.
 */
const UNKNOWN_TRAVEL_MINUTES = 20;

/**
 * When a meal may be planned.
 *
 * Both ends matter, and the second end was learned the hard way: dinner used
 * to be "after the last stop, but no earlier than seven", which on a packed
 * day that ran until eleven produced a dinner at 23:00. A window somebody
 * would actually eat in is the constraint; a day too full to fit it is a day
 * that gets no dinner planned, which is at least true.
 */
const LUNCH_FROM = 12 * 60;
const LUNCH_UNTIL = 14 * 60 + 30;
const DINNER_FROM = 19 * 60;
const DINNER_UNTIL = 21 * 60 + 30;

/* ------------------------------------------------------------------- scoring */

/** Preference dominates: a wanted category outranks a more famous unwanted one. */
const AFFINITY_WEIGHT = 2;
/** Notability, as OpenTripMap's `rate` mapped onto `Activity.rating`. */
const QUALITY_WEIGHT = 1;
/** Charged in proportion to how much of the ceiling a place uses up. */
const PRICE_WEIGHT = 1.5;
/** Charged per hour of travel away from the day's first stop. */
const TRAVEL_WEIGHT = 1.2;

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance. Straight-line, which is why the speed above is low. */
export function distanceKm(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Minutes between two stops, rounded up to the nearest five. */
export function travelMinutes(from: LatLng | undefined, to: LatLng | undefined): number {
  if (!from || !to) return UNKNOWN_TRAVEL_MINUTES;

  const minutes = (distanceKm(from, to) / TRAVEL_SPEED_KMH) * 60;

  return Math.max(MIN_TRAVEL_MINUTES, Math.ceil(minutes / 5) * 5);
}

/**
 * A zero price means "not published", not "free".
 *
 * Only a priced product carries a real figure — an OpenTripMap attraction has
 * no price at all and arrives as zero. So a ceiling filters the rows that
 * *state* a price and lets the rest through: excluding an unpriced museum for
 * failing a budget test it was never entered into would empty the pool of
 * everything worth seeing.
 */
function priceOf(activity: Activity): number | null {
  return activity.price > 0 ? activity.price : null;
}

function isAffordable(activity: Activity, preferences: TravelPreferences): boolean {
  const price = priceOf(activity);

  if (price === null || preferences.maxActivityPrice === null) return true;

  return price <= preferences.maxActivityPrice;
}

/**
 * How much this place is worth a slot, before the day it might land in.
 *
 * Deliberately a small weighted sum rather than anything cleverer: every term
 * is one somebody could be shown and argue with, which is the property that
 * matters when the answer is "why is this in my trip and that is not".
 */
export function scoreActivity(activity: Activity, preferences: TravelPreferences): number {
  const affinity = preferences.categoryWeights[activity.category] ?? 0;
  const quality = activity.rating > 0 ? activity.rating / 5 : 0;

  /*
   * The cost term is a slope, not a cliff, and it only exists when a ceiling
   * does.
   *
   * The cliff is already `isAffordable`, which drops anything over the ceiling
   * before this function is ever called — so a penalty for *exceeding* the
   * ceiling could never fire, and a first draft of this had one. What is worth
   * saying is the thing the filter cannot: between two equally good places
   * inside the budget, the cheaper one is the better answer for somebody who
   * set a budget at all.
   *
   * With no ceiling there is no penalty, because there is then no scale to
   * judge a price against — $80 is nothing for a dive trip and a lot for a
   * gallery, and this module cannot tell those apart.
   */
  const price = priceOf(activity);
  const ceiling = preferences.maxActivityPrice;
  const cost = price !== null && ceiling !== null && ceiling > 0 ? Math.min(1, price / ceiling) : 0;

  return AFFINITY_WEIGHT * affinity + QUALITY_WEIGHT * quality - PRICE_WEIGHT * cost;
}

/* --------------------------------------------------------------- the packing */

type Candidate = {
  activity: Activity;
  score: number;
};

/** Newest-first ordering is meaningless here; ties break on id so runs match. */
function byScoreThenId(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;

  return a.activity.id.localeCompare(b.activity.id);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Minutes past midnight back into the `HH:MM` an itinerary entry carries. */
export function formatTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));

  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/**
 * The stops for one day, nearest-neighbour from the anchor.
 *
 * The anchor is the best remaining place; the rest of the day is whatever
 * scores highest once the walk to get there is charged against it. That single
 * rule is what keeps a day in one part of a city, and it is why the itinerary
 * does not send somebody back and forth across town between two museums it
 * happened to rank highly.
 *
 * No second pass over the order: at three to five stops a nearest-neighbour
 * route is either optimal or one swap away from it, and the swap is worth less
 * than the code to find it.
 */
function chooseDayStops(
  pool: Candidate[],
  used: Set<string>,
  limit: number,
  preferences: TravelPreferences,
): Activity[] {
  const anchor = pool.find((candidate) => !used.has(candidate.activity.id));
  if (!anchor || limit <= 0) return [];

  used.add(anchor.activity.id);

  const chosen: Activity[] = [anchor.activity];
  let spent = priceOf(anchor.activity) ?? 0;

  while (chosen.length < limit) {
    const last = chosen[chosen.length - 1];

    let best: Candidate | null = null;
    let bestScore = -Infinity;

    for (const candidate of pool) {
      if (used.has(candidate.activity.id)) continue;

      const price = priceOf(candidate.activity) ?? 0;
      if (
        preferences.dailyActivityBudget !== null &&
        spent + price > preferences.dailyActivityBudget
      ) {
        continue;
      }

      const detour = travelMinutes(last.coordinates, candidate.activity.coordinates) / 60;
      const score = candidate.score - TRAVEL_WEIGHT * detour;

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) break;

    used.add(best.activity.id);
    chosen.push(best.activity);
    spent += priceOf(best.activity) ?? 0;
  }

  return chosen;
}

/**
 * Somewhere to eat, as near as possible to where the day already is.
 *
 * Returns null when the pool has no food left, which is a real outcome for a
 * small town rather than an error: the day simply has an unfilled hour in it,
 * the way it would if you had not decided yet.
 */
function chooseMeal(
  pool: Candidate[],
  used: Set<string>,
  near: LatLng | undefined,
): Activity | null {
  let best: Activity | null = null;
  let bestScore = -Infinity;

  for (const candidate of pool) {
    if (candidate.activity.category !== 'food' || used.has(candidate.activity.id)) continue;

    const detour = travelMinutes(near, candidate.activity.coordinates) / 60;
    const score = candidate.score - TRAVEL_WEIGHT * detour;

    if (score > bestScore) {
      best = candidate.activity;
      bestScore = score;
    }
  }

  if (best) used.add(best.id);

  return best;
}

/**
 * The day's stops laid out against the clock.
 *
 * Meals are inserted at the moment the day reaches their window rather than
 * planned in advance, so a lunch lands after whatever the morning turned out
 * to be. A stop that would begin after `dayEnd` is dropped, not squeezed —
 * the hours somebody gave are the constraint, and the alternative is an
 * itinerary that quietly says 21:40 for a museum.
 */
function layOutDay(
  stops: Activity[],
  meals: { lunch: Activity | null; dinner: Activity | null },
  preferences: TravelPreferences,
): ItineraryActivity[] {
  const endOfDay = minutesOf(preferences.dayEnd);
  const entries: ItineraryActivity[] = [];

  let cursor = minutesOf(preferences.dayStart);
  let previous: LatLng | undefined;

  /*
   * Meals are exempt from `dayEnd`, and that is not a hole in the constraint.
   *
   * `dayEnd` is the hour after which nothing new is *started* — a museum at
   * 19:40 is a mistake. Somebody who eats at seven has not asked to be indoors
   * by six, and dropping their dinner for being after hours would obey the
   * letter of the setting against its plain meaning. Their own window bounds
   * them instead.
   */
  const pending = [
    meals.lunch ? { activity: meals.lunch, from: LUNCH_FROM, until: LUNCH_UNTIL } : null,
    meals.dinner ? { activity: meals.dinner, from: DINNER_FROM, until: DINNER_UNTIL } : null,
  ].filter((meal) => meal !== null);

  const place = (activity: Activity, limit: number): boolean => {
    const arrival = previous ? cursor + travelMinutes(previous, activity.coordinates) : cursor;
    if (arrival > limit) return false;

    entries.push(toItineraryActivity(activity, formatTime(arrival)));
    cursor = arrival + CATEGORY_MINUTES[activity.category];
    previous = activity.coordinates;

    return true;
  };

  /** Any meal whose window the day has reached, before the next stop. */
  const placeDueMeals = () => {
    while (pending.length > 0 && cursor >= pending[0].from) {
      const meal = pending.shift();
      if (!meal) break;

      // Past its window: the day ran long, and a 23:00 dinner is not a plan.
      if (cursor > meal.until) continue;

      place(meal.activity, meal.until);
    }
  };

  for (const stop of stops) {
    placeDueMeals();
    if (!place(stop, endOfDay)) break;
  }

  /*
   * The meals the day never ran late enough to reach — the ordinary case for
   * dinner, since a day that ends at five has not got to seven yet. Waiting
   * until the window opens is exactly what somebody does.
   */
  for (const meal of pending) {
    if (cursor > meal.until) continue;

    cursor = Math.max(cursor, meal.from);
    place(meal.activity, meal.until);
  }

  return entries;
}

/** "Belém Tower, Jerónimos Monastery and 2 more" — what the day actually holds. */
function summarise(entries: ItineraryActivity[], destination: string): string {
  if (entries.length === 0) return `A free day in ${destination}`;

  const titles = entries.map((entry) => entry.title);
  if (titles.length <= 2) return titles.join(' and ');

  return `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
}

/* ------------------------------------------------------------------- the API */

/**
 * Days for a brief, drawn from a pool of real places.
 *
 * Returns an empty array when nothing in the pool survives the preferences —
 * a destination the attraction API knows nothing about, or a reader who has
 * ruled out every category. The caller decides what that means; `mockAi`
 * treats it as "fall back to the templates", which is the honest answer,
 * because a trip with no days in it is not a trip.
 *
 * No place is used twice across the trip. That is the one global constraint
 * here, and it is why days get quieter as a short pool runs out rather than
 * repeating Tuesday on Thursday.
 */
export function planItinerary(brief: TripBrief, pool: Activity[]): ItineraryDay[] {
  const preferences = brief.preferences;
  const start = fromIsoDate(brief.startDate);
  const days = Math.max(1, Math.floor(brief.days));

  if (minutesOf(preferences.dayEnd) <= minutesOf(preferences.dayStart)) return [];

  const candidates: Candidate[] = pool
    .filter((activity) => (preferences.categoryWeights[activity.category] ?? 0) > 0)
    .filter((activity) => isAffordable(activity, preferences))
    .map((activity) => ({ activity, score: scoreActivity(activity, preferences) }))
    .sort(byScoreThenId);

  if (candidates.length === 0) return [];

  // Meals come from the same pool and must not also be picked as sightseeing,
  // so one `used` set governs the whole trip.
  const used = new Set<string>();
  const itinerary: ItineraryDay[] = [];

  for (let index = 0; index < days; index += 1) {
    const isLastDay = index === days - 1 && days > 1;

    /*
     * The last day is lighter, the way a last day is: something is leaving,
     * and it is not this engine's place to say what. Nothing invents a flight
     * or a transfer to fill it — an itinerary activity is a guess and a
     * booking is a fact, and a made-up departure reads as the second.
     */
    const limit = Math.max(1, PACE_STOPS[preferences.pace] - (isLastDay ? 1 : 0));

    const stops = chooseDayStops(candidates, used, limit, preferences);
    const anchor = stops[0]?.coordinates;

    const meals = {
      lunch: preferences.meals.lunch ? chooseMeal(candidates, used, anchor) : null,
      dinner:
        preferences.meals.dinner && !isLastDay
          ? chooseMeal(candidates, used, stops[stops.length - 1]?.coordinates ?? anchor)
          : null,
    };

    const entries = layOutDay(stops, meals, preferences);

    itinerary.push({
      id: createId('day'),
      dayNumber: index + 1,
      date: toIsoDate(addDays(start, index)),
      destination: brief.destination,
      summary: summarise(entries, brief.destination),
      image: dayImage(entries.map((entry) => entry.category)),
      activities: entries,
    });
  }

  return itinerary;
}
