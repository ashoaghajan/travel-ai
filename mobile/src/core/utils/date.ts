/**
 * Date helpers for ISO calendar dates (`YYYY-MM-DD`).
 *
 * Dates are parsed and formatted in local time on purpose: `new Date('2026-05-20')`
 * is parsed as UTC midnight and can render as the 19th west of Greenwich.
 */

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTHS_LONG = [
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
] as const;

/** `YYYY-MM-DD` for a local date. */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Parses `YYYY-MM-DD` as a local date.
 *
 * Falls back to the epoch for unusable input rather than producing a silently
 * wrong date: `Number('')` is `0`, and `new Date(0, …)` means 1900, not 1970.
 */
export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);

  if (!Number.isFinite(year) || year === 0) return new Date(1970, 0, 1);

  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** "May 20" */
export function formatShortDate(iso: string): string {
  const date = fromIsoDate(iso);
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "May 20 - May 28" */
export function formatDateRange(startIso: string, endIso: string): string {
  return `${formatShortDate(startIso)} - ${formatShortDate(endIso)}`;
}

/**
 * "20 May 2026", from a full ISO **timestamp**.
 *
 * The other formatters here take a `YYYY-MM-DD` calendar date, because that is
 * what a trip is made of. This one takes an instant — the moment something
 * happened, as the server records it — which `fromIsoDate` cannot parse: it
 * splits on `-` and would read the day as `13T00:00:00.000Z`.
 *
 * Returns an empty string for anything unparseable rather than "Invalid Date",
 * so a caller can render it without a guard and get nothing instead of noise.
 */
export function formatLongDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  if (Number.isNaN(date.getTime())) return '';

  // `MONTHS_LONG` is lower case because `findMonthStart` matches against it;
  // capitalising here keeps that working rather than making parsing
  // case-insensitive to suit one label.
  const month = MONTHS_LONG[date.getMonth()];

  return `${date.getDate()} ${month[0].toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "May 20, Tue" — DESIGN_SPEC Screen 4 date fields. */
export function formatWeekdayDate(iso: string): string {
  const date = fromIsoDate(iso);
  return `${formatShortDate(iso)}, ${WEEKDAYS_SHORT[date.getDay()]}`;
}

/**
 * The next time a given month/day comes around, rolling into next year if it
 * has already passed. Keeps demo dates in the future without hard-coding a year.
 */
export function nextOccurrence(monthIndex: number, day: number, today = new Date()): Date {
  const thisYear = new Date(today.getFullYear(), monthIndex, day);
  return thisYear >= new Date(today.getFullYear(), today.getMonth(), today.getDate())
    ? thisYear
    : new Date(today.getFullYear() + 1, monthIndex, day);
}

/** Nights between two calendar dates, never negative. */
export function nightsBetween(startIso: string, endIso: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = fromIsoDate(endIso).getTime() - fromIsoDate(startIso).getTime();
  return Math.max(0, Math.round(diff / msPerDay));
}

/**
 * Finds a month name in free text and returns the first of that month, rolling
 * into next year if it has already passed. Returns `null` when no month is
 * mentioned.
 */
export function findMonthStart(text: string, today = new Date()): Date | null {
  const lower = text.toLowerCase();
  const monthIndex = MONTHS_LONG.findIndex((month) =>
    new RegExp(`\\b${month}\\b`).test(lower),
  );
  if (monthIndex === -1) return null;

  const year = monthIndex < today.getMonth() ? today.getFullYear() + 1 : today.getFullYear();
  return new Date(year, monthIndex, 1);
}

/* --------------------------------------------------- dates in a sentence */

/**
 * Month names as somebody types them, long and short, in match order.
 *
 * Longest first so "september" is not matched as "sep" with "tember" left
 * over — the alternation is greedy in the order it is written, and the short
 * forms are prefixes of the long ones.
 */
const MONTH_PATTERNS = MONTHS_LONG.map((month, index) => ({
  index,
  pattern: `${month}|${month.slice(0, 3)}\\.?`,
}));

const MONTH_ALTERNATION = MONTH_PATTERNS.map((month) => month.pattern).join('|');

/** "14", "14th", "3rd" — the ordinal suffix is noise and is dropped. */
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
/** "to", "-", "–", "until", "through". What separates two dates in a range. */
const RANGE = String.raw`\s*(?:to|until|till|through|thru|-|–|—)\s*`;

function monthIndexOf(word: string): number {
  const lower = word.toLowerCase().replace(/\.$/, '');

  return MONTHS_LONG.findIndex((month) => month === lower || month.slice(0, 3) === lower);
}

/**
 * A date somebody named, resolved to a real one.
 *
 * The year is never stated in these sentences, so it is inferred: the next
 * time that day comes around. Someone typing "14 September" on the 8th means
 * this month; someone typing "5 March" means next year. Rolling on the day
 * rather than on the month is what tells those apart — `findMonthStart` rolls
 * on the month, which is right for "a trip in March" and wrong for a date.
 */
function resolveDate(day: number, monthIndex: number, today: Date): Date | null {
  if (day < 1 || day > 31 || monthIndex < 0) return null;

  const candidate = new Date(today.getFullYear(), monthIndex, day);

  // A day the month does not have — "31 September" — rolls into October, which
  // is not what was meant. Better no date than a wrong one.
  if (candidate.getMonth() !== monthIndex) return null;

  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (candidate >= midnight) return candidate;

  const nextYear = new Date(today.getFullYear() + 1, monthIndex, day);

  return nextYear.getMonth() === monthIndex ? nextYear : null;
}

/**
 * The far end of a range, resolved against its own start rather than today.
 *
 * This is the difference between "28 to 2 September" and "28 December to 3
 * January". Resolved against today, the second date of each rolls forward a
 * year whenever it has already passed, which turns the first into a 340-day
 * trip. Resolved against the start, the January is next year because it falls
 * after December, and the 2nd of September is simply before the 28th — a range
 * written backwards, which the caller then declines to guess at.
 */
function resolveEnd(day: number, monthIndex: number, start: Date): Date | null {
  if (day < 1 || day > 31 || monthIndex < 0) return null;

  const sameYear = new Date(start.getFullYear(), monthIndex, day);
  if (sameYear.getMonth() !== monthIndex) return null;
  if (sameYear >= start) return sameYear;

  // Before its own start: the only honest reading is a turn of the year.
  const nextYear = new Date(start.getFullYear() + 1, monthIndex, day);

  return nextYear.getMonth() === monthIndex ? nextYear : null;
}

/**
 * The longest range this will read as one.
 *
 * Not a rule about holidays — the planner has its own, shorter ceiling. It is
 * a signal that the parse went wrong: two months apart usually means the two
 * numbers were never a range, and a single date is the safer answer than a
 * trip nobody asked for.
 */
const MAX_RANGE_DAYS = 60;

/** Whole days from one date to another, counting both ends. */
function inclusiveDays(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();

  return Math.round((end - start) / 86_400_000) + 1;
}

export type ParsedDates = {
  start: Date;
  /** Null when only one date was named — the length came from somewhere else. */
  days: number | null;
};

/**
 * The dates in a sentence, when it names any.
 *
 * This exists because `findMonthStart` was the only date parsing the planner
 * had, and a month is not a date: "a trip from 14 to 18 September" produced
 * the first of September for five days, which is a different holiday from the
 * one that was asked for. The forms below are the ones people actually type,
 * in the order that resolves them unambiguously:
 *
 * - `2027-04-02 to 2027-04-06` — ISO, both ends
 * - `14 to 18 September`, `14-18 Sep` — one month, shared
 * - `September 14 to 18`, `Sept 14–18` — month first
 * - `14 September to 18 September`, `Sep 14 to Sep 18` — both named
 * - `on 14 September`, `September 14` — one date, no end
 *
 * Returns null when the text names no date at all, which leaves the caller on
 * `findMonthStart` and then on its own default. An end that falls before its
 * start is treated as a single date rather than guessed at: "28 to 2 September"
 * probably crosses a month boundary, and a planner that quietly picked one
 * would be wrong about it half the time.
 */
export function findDates(text: string, today = new Date()): ParsedDates | null {
  const lower = text.toLowerCase();

  const single = (start: Date): ParsedDates => ({ start, days: null });

  const range = (start: Date, end: Date | null): ParsedDates => {
    if (!end) return single(start);

    const days = inclusiveDays(start, end);

    return days >= 1 && days <= MAX_RANGE_DAYS ? { start, days } : single(start);
  };

  // ISO first: unambiguous, and the only form that carries its own year.
  const iso = lower.match(
    new RegExp(String.raw`(\d{4}-\d{2}-\d{2})(?:${RANGE}(\d{4}-\d{2}-\d{2}))?`),
  );
  if (iso) {
    const start = fromIsoDate(iso[1]);
    return iso[2] ? range(start, fromIsoDate(iso[2])) : single(start);
  }

  // "14 September to 18 September", "Sep 14 to Sep 18" — both ends named.
  const bothNamed = lower.match(
    new RegExp(
      String.raw`(?:${DAY}\s*(${MONTH_ALTERNATION})|(${MONTH_ALTERNATION})\s*${DAY})` +
        RANGE +
        String.raw`(?:${DAY}\s*(${MONTH_ALTERNATION})|(${MONTH_ALTERNATION})\s*${DAY})`,
    ),
  );
  if (bothNamed) {
    const [, dayA, monthA, monthB, dayB, dayC, monthC, monthD, dayD] = bothNamed;
    const start = resolveDate(Number(dayA ?? dayB), monthIndexOf(monthA ?? monthB ?? ''), today);

    if (start) {
      return range(start, resolveEnd(Number(dayC ?? dayD), monthIndexOf(monthC ?? monthD ?? ''), start));
    }
  }

  // "14 to 18 September" — the month belongs to both.
  const dayRangeFirst = lower.match(
    new RegExp(DAY + RANGE + DAY + String.raw`\s*(?:of\s+)?(${MONTH_ALTERNATION})`),
  );
  if (dayRangeFirst) {
    const monthIndex = monthIndexOf(dayRangeFirst[3]);
    const start = resolveDate(Number(dayRangeFirst[1]), monthIndex, today);

    if (start) return range(start, resolveEnd(Number(dayRangeFirst[2]), monthIndex, start));
  }

  // "September 14 to 18" — the month leads.
  const monthFirst = lower.match(
    new RegExp(String.raw`(${MONTH_ALTERNATION})\s+` + DAY + RANGE + DAY),
  );
  if (monthFirst) {
    const monthIndex = monthIndexOf(monthFirst[1]);
    const start = resolveDate(Number(monthFirst[2]), monthIndex, today);

    if (start) return range(start, resolveEnd(Number(monthFirst[3]), monthIndex, start));
  }

  // One date, either way round.
  const one = lower.match(
    new RegExp(
      String.raw`(?:${DAY}\s*(?:of\s+)?(${MONTH_ALTERNATION})|(${MONTH_ALTERNATION})\s+${DAY})`,
    ),
  );
  if (one) {
    const [, dayA, monthA, monthB, dayB] = one;
    const start = resolveDate(Number(dayA ?? dayB), monthIndexOf(monthA ?? monthB ?? ''), today);

    if (start) return single(start);
  }

  return null;
}
