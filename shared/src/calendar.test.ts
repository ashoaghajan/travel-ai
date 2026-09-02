import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVITY_MINUTES,
  bookingsToCalendarEvents,
  calendarDestinations,
  parseTimeOfDay,
  shiftWallClock,
  toCalendarEvents,
  zonedTimeToInstant,
  type CalendarSourceDay,
} from './calendar';

function day(overrides: Partial<CalendarSourceDay> = {}): CalendarSourceDay {
  return {
    date: '2026-09-14',
    destination: 'Tbilisi',
    activities: [
      { id: 'activity_1', time: '19:30', title: 'Khinkali', description: 'Off Shavteli.' },
    ],
    ...overrides,
  };
}

describe('parseTimeOfDay', () => {
  it.each([
    ['09:30', 9, 30],
    ['9:05', 9, 5],
    [' 23:59 ', 23, 59],
    ['00:00', 0, 0],
  ])('reads %s', (time, hours, minutes) => {
    expect(parseTimeOfDay(time)).toEqual({ hours, minutes });
  });

  it.each(['soon', '', '24:00', '12:60', '1230', '12:3'])('rejects %s', (time) => {
    expect(parseTimeOfDay(time)).toBeNull();
  });
});

describe('shiftWallClock', () => {
  it('adds minutes within a day', () => {
    expect(shiftWallClock('2026-09-14', '19:30', 60)).toBe('2026-09-14T20:30:00');
  });

  it('carries over midnight into the next date', () => {
    expect(shiftWallClock('2026-09-14', '23:30', 90)).toBe('2026-09-15T01:00:00');
  });

  it('carries over the end of a month, and a year', () => {
    expect(shiftWallClock('2026-12-31', '23:30', 60)).toBe('2027-01-01T00:30:00');
  });

  it('returns null for an unreadable time or date', () => {
    expect(shiftWallClock('2026-09-14', 'soon', 60)).toBeNull();
    expect(shiftWallClock('next tuesday', '19:30', 60)).toBeNull();
  });
});

describe('toCalendarEvents', () => {
  it('gives an activity an hour by default', () => {
    const [event] = toCalendarEvents([day()]);

    expect(event.start).toBe('2026-09-14T19:30:00');
    expect(event.end).toBe('2026-09-14T20:30:00');
    expect(DEFAULT_ACTIVITY_MINUTES).toBe(60);
  });

  it('honours a duration the activity carries', () => {
    const [event] = toCalendarEvents([
      day({
        activities: [{ id: 'activity_1', time: '09:00', title: 'Kazbegi drive', durationMinutes: 240 }],
      }),
    ]);

    expect(event.end).toBe('2026-09-14T13:00:00');
  });

  it('ignores a nonsense duration rather than inverting the event', () => {
    const [event] = toCalendarEvents([
      day({ activities: [{ id: 'a', time: '09:00', title: 'Walk', durationMinutes: -30 }] }),
    ]);

    expect(event.end).toBe('2026-09-14T10:00:00');
  });

  it('takes each day into its own zone, so a trip can cross one', () => {
    const zones: Record<string, string> = {
      Tbilisi: 'Asia/Tbilisi',
      Moscow: 'Europe/Moscow',
    };

    const events = toCalendarEvents(
      [
        day(),
        day({
          date: '2026-09-16',
          destination: 'Moscow',
          activities: [{ id: 'activity_2', time: '10:00', title: 'Red Square' }],
        }),
      ],
      { timeZoneFor: (destination) => zones[destination] },
    );

    expect(events.map((event) => event.timeZone)).toEqual(['Asia/Tbilisi', 'Europe/Moscow']);
  });

  it('leaves the zone unset when a district label resolves to nothing', () => {
    const events = toCalendarEvents([day({ destination: 'Old Town (Abanotubani)' })], {
      timeZoneFor: () => undefined,
    });

    expect(events[0].timeZone).toBeUndefined();
    expect(events[0].location).toBe('Old Town (Abanotubani)');
  });

  it('drops an activity whose time cannot be read rather than guessing an hour', () => {
    const events = toCalendarEvents([
      day({
        activities: [
          { id: 'a', time: 'after lunch', title: 'Wander' },
          { id: 'b', time: '15:00', title: 'Sulphur bath' },
        ],
      }),
    ]);

    expect(events.map((event) => event.title)).toEqual(['Sulphur bath']);
  });

  it('keeps a uid that survives a second export', () => {
    const first = toCalendarEvents([day()]);
    const second = toCalendarEvents([day()]);

    expect(first[0].uid).toBe(second[0].uid);
    expect(first[0].uid).toContain('activity_1');
  });

  it('keeps itinerary order', () => {
    const events = toCalendarEvents([
      day({
        activities: [
          { id: 'a', time: '19:30', title: 'Dinner' },
          { id: 'b', time: '09:00', title: 'Breakfast' },
        ],
      }),
    ]);

    expect(events.map((event) => event.title)).toEqual(['Dinner', 'Breakfast']);
  });
});

describe('calendarDestinations', () => {
  it('lists each place once, so a zone is resolved once', () => {
    expect(
      calendarDestinations([
        day({ destination: 'Tbilisi' }),
        day({ destination: 'Tbilisi' }),
        day({ destination: ' Moscow ' }),
        day({ destination: '' }),
      ]),
    ).toEqual(['Tbilisi', 'Moscow']);
  });
});

describe('bookingsToCalendarEvents', () => {
  it('spans a stay from check-in to the day after check-out, so the bar covers the last morning', () => {
    const [event] = bookingsToCalendarEvents([
      { id: 'b1', kind: 'hotel', title: 'Rooms Hotel', date: '2026-09-14', endDate: '2026-09-18' },
    ]);

    expect(event.allDay).toBe(true);
    expect(event.start).toBe('2026-09-14');
    expect(event.end).toBe('2026-09-19');
  });

  it('gives a flight the one day it happens on', () => {
    const [event] = bookingsToCalendarEvents([
      { id: 'b2', kind: 'flight', title: 'EVN → TBS', date: '2026-09-14' },
    ]);

    expect(event.start).toBe('2026-09-14');
    expect(event.end).toBe('2026-09-15');
  });

  it('carries a reference where there is one, and nothing where there is not', () => {
    const [withRef, without] = bookingsToCalendarEvents([
      { id: 'b3', kind: 'flight', title: 'Outbound', date: '2026-09-14', reference: 'XY12Z' },
      { id: 'b4', kind: 'flight', title: 'Return', date: '2026-09-18' },
    ]);

    expect(withRef.description).toBe('Reference: XY12Z');
    expect(without.description).toBe('');
  });

  it('skips a booking with no date rather than guessing one', () => {
    expect(
      bookingsToCalendarEvents([{ id: 'b5', kind: 'ticket', title: 'Museum', date: '' }]),
    ).toEqual([]);
  });

  it('ignores a check-out that precedes check-in', () => {
    expect(
      bookingsToCalendarEvents([
        { id: 'b6', kind: 'hotel', title: 'Backwards', date: '2026-09-18', endDate: '2026-09-14' },
      ]),
    ).toEqual([]);
  });

  it('crosses a month boundary', () => {
    const [event] = bookingsToCalendarEvents([
      { id: 'b7', kind: 'hotel', title: 'Stay', date: '2026-09-29', endDate: '2026-09-30' },
    ]);

    expect(event.end).toBe('2026-10-01');
  });
});

describe('zonedTimeToInstant', () => {
  it('reads a wall clock in the zone it belongs to', () => {
    // 19:30 in Tbilisi (UTC+4, no DST) is 15:30Z.
    expect(zonedTimeToInstant('2026-09-14T19:30:00', 'Asia/Tbilisi')?.toISOString()).toBe(
      '2026-09-14T15:30:00.000Z',
    );
  });

  it('is right on either side of a daylight-saving change', () => {
    // Lisbon is UTC+1 in summer and UTC+0 in winter; the clocks go back on
    // 2026-10-25. A fixed offset would put one of these an hour out.
    expect(zonedTimeToInstant('2026-10-24T12:00:00', 'Europe/Lisbon')?.toISOString()).toBe(
      '2026-10-24T11:00:00.000Z',
    );
    expect(zonedTimeToInstant('2026-10-26T12:00:00', 'Europe/Lisbon')?.toISOString()).toBe(
      '2026-10-26T12:00:00.000Z',
    );
  });

  it('handles a zone west of Greenwich', () => {
    expect(zonedTimeToInstant('2026-01-15T09:00:00', 'America/New_York')?.toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('takes a bare date as midnight', () => {
    expect(zonedTimeToInstant('2026-09-14', 'Asia/Tbilisi')?.toISOString()).toBe(
      '2026-09-13T20:00:00.000Z',
    );
  });

  it('falls back to local time when no zone is known', () => {
    const local = zonedTimeToInstant('2026-09-14T19:30:00');

    expect(local?.getHours()).toBe(19);
    expect(local?.getMinutes()).toBe(30);
  });

  it('returns null for something that is not a date', () => {
    expect(zonedTimeToInstant('whenever', 'Asia/Tbilisi')).toBeNull();
  });
});

describe('zonedTimeToInstant, when the engine has no zone data', () => {
  it('falls back to local time rather than returning an Invalid Date', () => {
    // Hermes has shipped without the zone database, and `Intl` then formats
    // something unparseable instead of throwing. An Invalid Date is truthy, so
    // a null check at the call site would not catch it.
    const real = Intl.DateTimeFormat;

    try {
      // @ts-expect-error — deliberately replacing the built-in for this test.
      Intl.DateTimeFormat = function () {
        return { formatToParts: () => [{ type: 'literal', value: '?' }] };
      };

      const result = zonedTimeToInstant('2026-09-14T19:30:00', 'Asia/Tbilisi');

      expect(result).not.toBeNull();
      expect(Number.isNaN(result!.getTime())).toBe(false);
      expect(result!.getHours()).toBe(19);
    } finally {
      Intl.DateTimeFormat = real;
    }
  });
});
