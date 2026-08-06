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
