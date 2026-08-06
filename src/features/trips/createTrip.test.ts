import { describe, expect, it } from 'vitest';
import { addDays, fromIsoDate, toIsoDate } from '../../utils/date';
import {
  MAX_TRIP_DAYS,
  dayCount,
  emptyCreateDraft,
  scaffoldDays,
  toTripDraft,
  validateCreate,
} from './createTrip';
import type { TripCreateDraft } from './createTrip';
import { hasErrors } from './editTrip';

function makeDraft(overrides: Partial<TripCreateDraft> = {}): TripCreateDraft {
  return {
    title: 'Lisbon in spring',
    destinationCountry: 'Portugal',
    destinationCity: 'Lisbon',
    startDate: '2027-05-20',
    endDate: '2027-05-24',
    travellers: 2,
    coverImage: '/city.jpg',
    ...overrides,
  };
}

/**
 * The end date of a range starting at `startIso` and covering `days` days.
 *
 * Goes through the app's own date helpers rather than `toISOString`, which
 * converts to UTC and lands on the previous day east of Greenwich.
 */
function endAfter(startIso: string, days: number): string {
  return toIsoDate(addDays(fromIsoDate(startIso), days - 1));
}

describe('emptyCreateDraft', () => {
  const draft = emptyCreateDraft(new Date(2027, 0, 1));

  it('opens a month out', () => {
    expect(draft.startDate).toBe('2027-01-31');
  });

  it('spans five days', () => {
    expect(draft.endDate).toBe('2027-02-04');
  });

  it('assumes nothing about the destination', () => {
    expect(draft.title).toBe('');
    expect(draft.destinationCity).toBe('');
    expect(draft.destinationCountry).toBe('');
  });

  it('starts with two travellers and a cover', () => {
    expect(draft.travellers).toBe(2);
    expect(draft.coverImage).not.toBe('');
  });
});

describe('dayCount', () => {
  it('counts both ends of the range', () => {
    expect(dayCount('2027-05-20', '2027-05-24')).toBe(5);
  });

  it('counts a single day as one', () => {
    expect(dayCount('2027-05-20', '2027-05-20')).toBe(1);
  });

  it('is zero when the range is reversed', () => {
    expect(dayCount('2027-05-24', '2027-05-20')).toBe(0);
  });

  it('is zero when either end is missing', () => {
    expect(dayCount('', '2027-05-24')).toBe(0);
    expect(dayCount('2027-05-20', '')).toBe(0);
  });
});

describe('scaffoldDays', () => {
  const days = scaffoldDays('2027-05-20', '2027-05-24', 'Lisbon');

  it('makes one day per date', () => {
    expect(days).toHaveLength(5);
  });

  it('numbers the days from one', () => {
    expect(days.map((day) => day.dayNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('advances the date by one each day', () => {
    expect(days.map((day) => day.date)).toEqual([
      '2027-05-20',
      '2027-05-21',
      '2027-05-22',
      '2027-05-23',
      '2027-05-24',
    ]);
  });

  it('leaves every day empty', () => {
    expect(days.every((day) => day.activities.length === 0)).toBe(true);
    expect(days.every((day) => day.summary === '')).toBe(true);
  });

  it('names every day for the destination', () => {
    expect(days.every((day) => day.destination === 'Lisbon')).toBe(true);
  });

  it('gives every day its own id', () => {
    expect(new Set(days.map((day) => day.id)).size).toBe(days.length);
  });

  // The whole reason this goes through `addDays`/`toIsoDate` rather than
  // arithmetic on the day number.
  it('crosses a month boundary', () => {
    expect(scaffoldDays('2027-01-30', '2027-02-02', 'Porto').map((day) => day.date)).toEqual([
      '2027-01-30',
      '2027-01-31',
      '2027-02-01',
      '2027-02-02',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(scaffoldDays('2027-12-31', '2028-01-01', 'Porto').map((day) => day.date)).toEqual([
      '2027-12-31',
      '2028-01-01',
    ]);
  });

  it('clamps a runaway range rather than allocating it', () => {
    expect(scaffoldDays('2027-01-01', '2037-01-01', 'Lisbon')).toHaveLength(MAX_TRIP_DAYS);
  });

  it('makes nothing from an unusable range', () => {
    expect(scaffoldDays('2027-05-24', '2027-05-20', 'Lisbon')).toEqual([]);
    expect(scaffoldDays('', '', 'Lisbon')).toEqual([]);
  });
});

describe('validateCreate', () => {
  /**
   * The day the fixture trip begins.
   *
   * Passed explicitly everywhere below: `validateCreate` now compares the start
   * date against today, so leaving it to the real clock would make this whole
   * block start failing once the fixture's dates fell into the past.
   */
  const TODAY = new Date(2027, 4, 20);

  it('accepts a sound draft', () => {
    expect(hasErrors(validateCreate(makeDraft(), TODAY))).toBe(false);
  });

  it('wants a title', () => {
    expect(validateCreate(makeDraft({ title: '  ' }), TODAY).title).toBeDefined();
  });

  it('wants a city or a country', () => {
    const errors = validateCreate(
      makeDraft({ destinationCity: '', destinationCountry: '' }),
      TODAY,
    );
    expect(errors.destination).toBeDefined();
  });

  it('accepts a country with no city', () => {
    expect(hasErrors(validateCreate(makeDraft({ destinationCity: '' }), TODAY))).toBe(false);
  });

  it('refuses an end date before the start', () => {
    expect(validateCreate(makeDraft({ endDate: '2027-05-19' }), TODAY).endDate).toBeDefined();
  });

  it.each([0, -1, 1.5])('refuses %s travellers', (travellers) => {
    expect(validateCreate(makeDraft({ travellers }), TODAY).travellers).toBeDefined();
  });

  it('refuses a start date in the past', () => {
    const errors = validateCreate(
      makeDraft({ startDate: '2027-05-19', endDate: '2027-05-24' }),
      TODAY,
    );

    expect(errors.startDate).toBe('A trip cannot start in the past.');
  });

  it('accepts a trip starting today', () => {
    const draft = makeDraft({ startDate: '2027-05-20', endDate: '2027-05-24' });

    expect(hasErrors(validateCreate(draft, TODAY))).toBe(false);
  });

  it('accepts a trip starting tomorrow', () => {
    const draft = makeDraft({ startDate: '2027-05-21', endDate: '2027-05-24' });

    expect(hasErrors(validateCreate(draft, TODAY))).toBe(false);
  });

  // The missing-date message is the one the reader can act on.
  it('asks for a start date before complaining it is past', () => {
    const errors = validateCreate(
      makeDraft({ startDate: '', endDate: '2027-05-24' }),
      TODAY,
    );

    expect(errors.startDate).toBe('Pick a start date.');
  });

  it('refuses a range longer than the cap', () => {
    const endDate = endAfter('2027-05-20', MAX_TRIP_DAYS + 1);
    expect(validateCreate(makeDraft({ endDate }), TODAY).endDate).toBeDefined();
  });

  it('accepts a range exactly at the cap', () => {
    const endDate = endAfter('2027-05-20', MAX_TRIP_DAYS);
    expect(hasErrors(validateCreate(makeDraft({ endDate }), TODAY))).toBe(false);
  });

  // A reversed range is also "longer than the cap" by no sensible reading —
  // the message the user can act on is the one about the order.
  it('reports the order before the length', () => {
    const errors = validateCreate(
      makeDraft({ startDate: '2037-05-20', endDate: '2027-05-20' }),
      TODAY,
    );
    expect(errors.endDate).toBe('The end date cannot be before the start date.');
  });
});

describe('toTripDraft', () => {
  it('trims the free text', () => {
    const draft = toTripDraft(
      makeDraft({ title: '  Lisbon  ', destinationCity: '  Lisbon  ' }),
      'draft_1',
    );
    expect(draft.title).toBe('Lisbon');
    expect(draft.destinationCity).toBe('Lisbon');
  });

  it('labels the trip with the city', () => {
    expect(toTripDraft(makeDraft(), 'draft_1').destination).toBe('Lisbon');
  });

  it('falls back to the country when there is no city', () => {
    expect(toTripDraft(makeDraft({ destinationCity: '' }), 'draft_1').destination).toBe(
      'Portugal',
    );
  });

  it('drops an unnamed city or country rather than storing an empty string', () => {
    const draft = toTripDraft(makeDraft({ destinationCity: '' }), 'draft_1');
    expect(draft.destinationCity).toBeUndefined();
  });

  it('carries the draft id and the cover through', () => {
    const draft = toTripDraft(makeDraft({ coverImage: '/coast.jpg' }), 'draft_7');
    expect(draft.draftId).toBe('draft_7');
    expect(draft.coverImage).toBe('/coast.jpg');
  });

  it('scaffolds a day for every date', () => {
    expect(toTripDraft(makeDraft(), 'draft_1').itinerary).toHaveLength(5);
  });

  it('names the scaffolded days for the destination', () => {
    const { itinerary } = toTripDraft(makeDraft(), 'draft_1');
    expect(itinerary.every((day) => day.destination === 'Lisbon')).toBe(true);
  });

  // An explicit 0 would stop `calculateTripCosts` recomputing the activities
  // line, pinning the total at nothing as the trip filled up.
  it('sets no cost estimates at all', () => {
    const draft = toTripDraft(makeDraft(), 'draft_1');
    expect('flightsEstimate' in draft).toBe(false);
    expect('hotelsEstimate' in draft).toBe(false);
    expect('activitiesEstimate' in draft).toBe(false);
  });
});
