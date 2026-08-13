import { describe, expect, it } from 'vitest';
import {
  addDays,
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
