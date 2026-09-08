import { describe, expect, it } from 'vitest';
import {
  addDays,
  findDates,
  findMonthStart,
  formatDateRange,
  formatLongDate,
  formatShortDate,
  formatWeekdayDate,
  fromIsoDate,
  nextOccurrence,
  nightsBetween,
  toIsoDate,
} from './date';

describe('fromIsoDate', () => {
  it('parses as a local date, not UTC', () => {
    // `new Date('2027-05-20')` is UTC midnight, which renders as the 19th in
    // any timezone west of Greenwich. Manual parsing avoids that.
    const date = fromIsoDate('2027-05-20');

    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(4);
    expect(date.getDate()).toBe(20);
  });
});

describe('toIsoDate', () => {
  it('pads month and day', () => {
    expect(toIsoDate(new Date(2027, 0, 5))).toBe('2027-01-05');
  });

  it('round-trips with fromIsoDate', () => {
    expect(toIsoDate(fromIsoDate('2027-11-30'))).toBe('2027-11-30');
  });
});

describe('addDays', () => {
  it('adds within a month', () => {
    expect(toIsoDate(addDays(fromIsoDate('2027-06-01'), 6))).toBe('2027-06-07');
  });

  it('crosses a month boundary', () => {
    expect(toIsoDate(addDays(fromIsoDate('2027-06-28'), 5))).toBe('2027-07-03');
  });

  it('crosses a year boundary', () => {
    expect(toIsoDate(addDays(fromIsoDate('2027-12-30'), 3))).toBe('2028-01-02');
  });

  it('handles a leap day', () => {
    expect(toIsoDate(addDays(fromIsoDate('2028-02-28'), 1))).toBe('2028-02-29');
  });

  it('does not mutate its argument', () => {
    const original = fromIsoDate('2027-06-01');
    addDays(original, 10);

    expect(toIsoDate(original)).toBe('2027-06-01');
  });
});

describe('formatting', () => {
  it('formats a short date', () => {
    expect(formatShortDate('2027-05-20')).toBe('May 20');
  });

  it('formats a range', () => {
    expect(formatDateRange('2027-05-20', '2027-05-26')).toBe('May 20 - May 26');
  });

  it('formats a range that crosses months', () => {
    expect(formatDateRange('2027-05-30', '2027-06-03')).toBe('May 30 - Jun 3');
  });

  it('adds the weekday for search fields', () => {
    // 20 May 2027 is a Thursday.
    expect(formatWeekdayDate('2027-05-20')).toBe('May 20, Thu');
  });
});

describe('nightsBetween', () => {
  it('counts nights, not days — a 7-day trip is 6 nights', () => {
    expect(nightsBetween('2027-06-01', '2027-06-07')).toBe(6);
  });

  it('is zero for a same-day trip', () => {
    expect(nightsBetween('2027-06-01', '2027-06-01')).toBe(0);
  });

  it('never goes negative', () => {
    expect(nightsBetween('2027-06-07', '2027-06-01')).toBe(0);
  });

  it('counts across a month boundary', () => {
    expect(nightsBetween('2027-05-30', '2027-06-02')).toBe(3);
  });
});

describe('findMonthStart', () => {
  const july2026 = new Date(2026, 6, 28);

  it('finds a month later this year', () => {
    const found = findMonthStart('a trip in September', july2026);

    expect(found && toIsoDate(found)).toBe('2026-09-01');
  });

  it('rolls a month that has passed into next year', () => {
    const found = findMonthStart('a trip in May', july2026);

    expect(found && toIsoDate(found)).toBe('2027-05-01');
  });

  it('is case insensitive', () => {
    expect(findMonthStart('sometime in JUNE', july2026)).not.toBeNull();
  });

  it('returns null when no month is named', () => {
    expect(findMonthStart('somewhere warm', july2026)).toBeNull();
  });

  it('does not match a month inside another word', () => {
    expect(findMonthStart('mayonnaise tasting tour', july2026)).toBeNull();
  });
});

describe('nextOccurrence', () => {
  const july2026 = new Date(2026, 6, 28);

  it('uses this year when the date is still ahead', () => {
    expect(toIsoDate(nextOccurrence(11, 25, july2026))).toBe('2026-12-25');
  });

  it('rolls into next year when the date has passed', () => {
    expect(toIsoDate(nextOccurrence(4, 20, july2026))).toBe('2027-05-20');
  });

  it('counts today as still ahead', () => {
    expect(toIsoDate(nextOccurrence(6, 28, july2026))).toBe('2026-07-28');
  });
});

describe('malformed input', () => {
  it('does not throw on an empty date string', () => {
    const date = fromIsoDate('');

    expect(date.getFullYear()).toBe(1970);
    expect(date.getDate()).toBe(1);
  });

  it('fills in missing parts of a partial date', () => {
    expect(toIsoDate(fromIsoDate('2027'))).toBe('2027-01-01');
  });
});

describe('unusable input', () => {
  it('falls back to the epoch rather than a silently wrong date', () => {
    // `Number('')` is 0, and `new Date(0, ...)` means 1900.
    expect(toIsoDate(fromIsoDate(''))).toBe('1970-01-01');
    expect(toIsoDate(fromIsoDate('not-a-date'))).toBe('1970-01-01');
  });
});

describe('formatLongDate', () => {
  it('reads a full timestamp, which the calendar-date parsers cannot', () => {
    // `fromIsoDate` splits on "-" and would read the day as "13T10:00:00.000Z".
    expect(formatLongDate('2026-08-13T10:00:00.000Z')).toBe('13 August 2026');
  });

  it('capitalises the month without breaking the parser it borrows', () => {
    // `MONTHS_LONG` is lower case because `findMonthStart` matches against it.
    expect(formatLongDate('2026-01-01T00:00:00.000Z')).toBe('1 January 2026');
  });

  it('gives nothing back for something unparseable', () => {
    // So a caller can render it bare and get nothing rather than "Invalid Date".
    expect(formatLongDate('not a date')).toBe('');
    expect(formatLongDate('')).toBe('');
  });
});

/**
 * Dates in a sentence.
 *
 * Written after a browser found the gap: "plan a new trip from 14 to 18
 * september" produced the first of September. The planner knew months and did
 * not know dates, so a trip somebody had stated exactly came back in the wrong
 * week — the one kind of wrong answer that looks entirely deliberate.
 */
describe('findDates', () => {
  // A Tuesday, mid-September, so both "later this month" and "already gone"
  // are reachable from one fixed today.
  const TODAY = new Date(2026, 8, 8);

  const parse = (text: string) => {
    const found = findDates(text, TODAY);

    return found ? { start: toIsoDate(found.start), days: found.days } : null;
  };

  it('reads a range that shares its month', () => {
    expect(parse('plan a new trip from 14 to 18 september in Tbilisi')).toEqual({
      start: '2026-09-14',
      days: 5,
    });
  });

  it('reads the same range written with a dash', () => {
    expect(parse('Tbilisi 14-18 Sept')).toEqual({ start: '2026-09-14', days: 5 });
    expect(parse('Tbilisi 14–18 September')).toEqual({ start: '2026-09-14', days: 5 });
  });

  it('reads a range with the month in front', () => {
    expect(parse('September 14 to 18 in Tbilisi')).toEqual({ start: '2026-09-14', days: 5 });
  });

  it('reads a range with both ends named', () => {
    expect(parse('14 September to 18 September')).toEqual({ start: '2026-09-14', days: 5 });
    expect(parse('Sep 14 until Sep 18')).toEqual({ start: '2026-09-14', days: 5 });
  });

  it('reads an ISO range, which is the only form carrying its own year', () => {
    expect(parse('2027-04-02 to 2027-04-06')).toEqual({ start: '2027-04-02', days: 5 });
  });

  it('drops the ordinal somebody typed', () => {
    expect(parse('14th to 18th September')).toEqual({ start: '2026-09-14', days: 5 });
  });

  it('gives no length for a single date, so the sentence can still say one', () => {
    expect(parse('a trip on 14 September')).toEqual({ start: '2026-09-14', days: null });
    expect(parse('September 14')).toEqual({ start: '2026-09-14', days: null });
  });

  it('rolls a date that has already gone into next year', () => {
    // Rolling on the day rather than the month is what tells "the 14th, in six
    // days" from "the 5th, next year" — both are September from here.
    expect(parse('5 September')).toEqual({ start: '2027-09-05', days: null });
    expect(parse('5 March')).toEqual({ start: '2027-03-05', days: null });
  });

  it('keeps today itself', () => {
    expect(parse('8 September')).toEqual({ start: '2026-09-08', days: null });
  });

  it('says nothing about a month with no day in it', () => {
    // That is `findMonthStart`'s job, and the first of the month is the right
    // reading there — it is the wrong one for a date.
    expect(parse('a week in June')).toBeNull();
  });

  it('refuses a day the month does not have', () => {
    // Left to `Date`, "31 September" becomes the 1st of October, which is a
    // real date and not the one that was asked for.
    expect(parse('31 September')).toBeNull();
    expect(parse('30 February')).toBeNull();
  });

  it('treats a backwards range as a single date rather than guessing', () => {
    // "28 to 2 September" probably crosses into October, and a planner that
    // picked one reading would be wrong about it half the time.
    const parsed = parse('28 to 2 September');

    expect(parsed?.start).toBe('2026-09-28');
    expect(parsed?.days).toBeNull();
  });

  it('finds nothing in a sentence with no date in it', () => {
    expect(parse('plan me something nice')).toBeNull();
    expect(parse('somewhere warm for a week')).toBeNull();
  });
});

describe('findDates, across the turn of a year', () => {
  const TODAY = new Date(2026, 8, 8);

  it('reads a range that crosses into January', () => {
    const found = findDates('28 December to 3 January', TODAY);

    // The end is resolved against its own start, so January is the next one.
    expect(found && toIsoDate(found.start)).toBe('2026-12-28');
    expect(found?.days).toBe(7);
  });
});
