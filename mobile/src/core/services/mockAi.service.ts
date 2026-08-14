import type { GeneratedItinerary } from '../types/planner.types';
import type { ItineraryActivity, ItineraryDay, TripDraft } from '../types/trip.types';
import {
  DESTINATION_TEMPLATES,
  GENERIC_DESTINATION,
  type DayTemplate,
  type DestinationTemplate,
} from '../mock/destinations';
import { addDays, findMonthStart, toIsoDate } from '../utils/date';
import { createId } from '../utils/id';

/**
 * Stage 1 stand-in for the AI planner.
 *
 * It reads a few things out of the prompt (destination, length, party size,
 * month) and assembles an itinerary from the mock templates. Stage 2 replaces
 * this module with a call to the real provider — `planner.service.ts` is the
 * seam, so nothing outside imports this file.
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

function resolveStartDate(prompt: string): Date {
  return findMonthStart(prompt) ?? addDays(new Date(), DEFAULT_LEAD_DAYS);
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

export const mockAiService = {
  async generateItinerary(prompt: string): Promise<GeneratedItinerary> {
    await delay(GENERATION_DELAY_MS);

    const { template, name } = resolveDestination(prompt);
    const days = parseDays(prompt);

    const trip = buildTripDraft({
      template,
      // Falls back to a neutral label when the prompt names no place.
      destinationName: name ?? GENERIC_DESTINATION.name,
      days,
      travellers: parseTravellers(prompt),
      startDate: resolveStartDate(prompt),
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
