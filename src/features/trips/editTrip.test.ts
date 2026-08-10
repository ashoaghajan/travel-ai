import { describe, expect, it } from 'vitest';
import type { Trip } from '../../types/trip.types';
import type { Activity } from '../../types/travel.types';
import {
  DEFAULT_ACTIVITY_TIME,
  addActivity,
  addPickedActivity,
  destinationLabel,
  hasErrors,
  isDirty,
  removeActivity,
  toEditDraft,
  toPatch,
  updateActivity,
  validate,
} from './editTrip';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Bali Adventure',
    destination: 'Bali',
    destinationCountry: 'Indonesia',
    destinationCity: 'Bali',
    startDate: '2027-05-20',
    endDate: '2027-05-26',
    travellers: 2,
    coverImage: '/bali.jpg',
    itinerary: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2027-05-20',
        destination: 'Ubud',
        summary: 'Welcome & relax',
        activities: [
          {
            id: 'act-1',
            time: '14:00',
            title: 'Check in',
            description: 'Settle in slowly.',
            category: 'relaxation',
          },
        ],
      },
    ],
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('toEditDraft', () => {
  it('carries the editable fields across', () => {
    expect(toEditDraft(makeTrip())).toMatchObject({
      title: 'Bali Adventure',
      destinationCountry: 'Indonesia',
      destinationCity: 'Bali',
      startDate: '2027-05-20',
      endDate: '2027-05-26',
      travellers: 2,
    });
  });

  it('reads a legacy trip’s single destination as the city', () => {
    const draft = toEditDraft(
      makeTrip({ destination: 'Lisbon', destinationCity: undefined, destinationCountry: undefined }),
    );

    expect(draft.destinationCity).toBe('Lisbon');
    expect(draft.destinationCountry).toBe('');
  });

  it('deep-copies the itinerary, so edits cannot leak into the trip', () => {
    const trip = makeTrip();
    const draft = toEditDraft(trip);

    draft.itinerary[0].activities[0].title = 'Changed';

    expect(trip.itinerary[0].activities[0].title).toBe('Check in');
  });
});

describe('isDirty', () => {
  it('is false for an untouched draft', () => {
    const trip = makeTrip();

    expect(isDirty(trip, toEditDraft(trip))).toBe(false);
  });

  it('notices a changed field', () => {
    const trip = makeTrip();

    expect(isDirty(trip, { ...toEditDraft(trip), title: 'New title' })).toBe(true);
  });

  it('notices an edited activity', () => {
    const trip = makeTrip();
    const draft = updateActivity(toEditDraft(trip), 'day-1', 'act-1', { title: 'Something else' });

    expect(isDirty(trip, draft)).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    const trip = makeTrip();

    expect(isDirty(trip, { ...toEditDraft(trip), title: '  Bali Adventure  ' })).toBe(false);
  });
});

describe('validate', () => {
  it('accepts a sound draft', () => {
    expect(hasErrors(validate(toEditDraft(makeTrip())))).toBe(false);
  });

  it('requires a title', () => {
    expect(validate({ ...toEditDraft(makeTrip()), title: '  ' }).title).toBeDefined();
  });

  it('requires a city or a country', () => {
    const draft = { ...toEditDraft(makeTrip()), destinationCity: '', destinationCountry: '' };

    expect(validate(draft).destination).toBeDefined();
  });

  it('accepts a country with no city', () => {
    const draft = { ...toEditDraft(makeTrip()), destinationCity: '', destinationCountry: 'Japan' };

    expect(validate(draft).destination).toBeUndefined();
  });

  it('rejects an end date before the start', () => {
    const draft = { ...toEditDraft(makeTrip()), endDate: '2027-05-19' };

    expect(validate(draft).endDate).toMatch(/before the start/);
  });

  it('accepts a single-day trip', () => {
    const draft = { ...toEditDraft(makeTrip()), endDate: '2027-05-20' };

    expect(validate(draft).endDate).toBeUndefined();
  });

  it.each([[0], [-1], [1.5]])('rejects %s travellers', (travellers) => {
    expect(validate({ ...toEditDraft(makeTrip()), travellers }).travellers).toBeDefined();
  });

  it('requires missing dates', () => {
    const draft = { ...toEditDraft(makeTrip()), startDate: '', endDate: '' };
    const errors = validate(draft);

    expect(errors.startDate).toBeDefined();
    expect(errors.endDate).toBeDefined();
  });

  it('flags an activity with no title, against its own id', () => {
    const draft = updateActivity(toEditDraft(makeTrip()), 'day-1', 'act-1', { title: ' ' });

    expect(validate(draft).activities?.['act-1']).toMatch(/title/);
  });

  it.each([['9:30'], ['25:00'], ['09:60'], ['noon'], ['']])('rejects the time %s', (time) => {
    const draft = updateActivity(toEditDraft(makeTrip()), 'day-1', 'act-1', { time });

    expect(validate(draft).activities?.['act-1']).toBeDefined();
  });

  it('accepts a well-formed time', () => {
    const draft = updateActivity(toEditDraft(makeTrip()), 'day-1', 'act-1', { time: '09:30' });

    expect(validate(draft).activities).toBeUndefined();
  });
});

describe('toPatch', () => {
  it('is empty when nothing changed', () => {
    const trip = makeTrip();

    expect(toPatch(trip, toEditDraft(trip))).toEqual({});
  });

  it('carries only the fields that changed', () => {
    const trip = makeTrip();

    expect(toPatch(trip, { ...toEditDraft(trip), travellers: 4 })).toEqual({ travellers: 4 });
  });

  it('keeps the display destination following the city', () => {
    const trip = makeTrip();

    const patch = toPatch(trip, { ...toEditDraft(trip), destinationCity: 'Ubud' });

    expect(patch).toMatchObject({ destinationCity: 'Ubud', destination: 'Ubud' });
  });

  it('falls back to the country when the city is cleared', () => {
    const trip = makeTrip();

    const patch = toPatch(trip, { ...toEditDraft(trip), destinationCity: '' });

    // `null`, not `undefined`: the key has to survive JSON.stringify, or the
    // server never hears that the city was cleared and keeps the old one.
    expect(patch.destinationCity).toBeNull();
    expect(patch.destination).toBe('Indonesia');
  });

  it('trims the values it sends', () => {
    const trip = makeTrip();

    expect(toPatch(trip, { ...toEditDraft(trip), title: '  New title  ' })).toEqual({
      title: 'New title',
    });
  });

  it('sends the whole itinerary when any part of it changed', () => {
    const trip = makeTrip();
    const draft = updateActivity(toEditDraft(trip), 'day-1', 'act-1', { title: 'Changed' });

    const patch = toPatch(trip, draft);

    expect(patch.itinerary?.[0].activities[0].title).toBe('Changed');
    expect(Object.keys(patch)).toEqual(['itinerary']);
  });
});

describe('itinerary edits', () => {
  it('updates one activity and leaves the rest alone', () => {
    const draft = updateActivity(toEditDraft(makeTrip()), 'day-1', 'act-1', {
      description: 'New description',
    });

    expect(draft.itinerary[0].activities[0]).toMatchObject({
      title: 'Check in',
      description: 'New description',
    });
  });

  it('ignores an unknown day or activity', () => {
    const draft = toEditDraft(makeTrip());

    expect(updateActivity(draft, 'day-9', 'act-1', { title: 'x' })).toEqual(draft);
    expect(updateActivity(draft, 'day-1', 'act-9', { title: 'x' })).toEqual(draft);
  });

  it('removes an activity', () => {
    const draft = removeActivity(toEditDraft(makeTrip()), 'day-1', 'act-1');

    expect(draft.itinerary[0].activities).toHaveLength(0);
  });

  it('appends an empty activity for the user to fill in', () => {
    const draft = addActivity(toEditDraft(makeTrip()), 'day-1');
    const added = draft.itinerary[0].activities[1];

    expect(draft.itinerary[0].activities).toHaveLength(2);
    expect(added).toMatchObject({ title: '', description: '', time: '12:00' });
    expect(added.id).toBeTruthy();
  });

  it('gives each added activity its own id', () => {
    const draft = addActivity(addActivity(toEditDraft(makeTrip()), 'day-1'), 'day-1');
    const [, first, second] = draft.itinerary[0].activities;

    expect(first.id).not.toBe(second.id);
  });

  it('never mutates the draft it was given', () => {
    const draft = toEditDraft(makeTrip());

    addActivity(draft, 'day-1');
    removeActivity(draft, 'day-1', 'act-1');
    updateActivity(draft, 'day-1', 'act-1', { title: 'x' });

    expect(draft.itinerary[0].activities).toHaveLength(1);
    expect(draft.itinerary[0].activities[0].title).toBe('Check in');
  });
});

describe('destinationLabel', () => {
  it('prefers the city', () => {
    expect(destinationLabel(toEditDraft(makeTrip()))).toBe('Bali');
  });

  it('falls back to the country', () => {
    const draft = { ...toEditDraft(makeTrip()), destinationCity: '   ' };

    expect(destinationLabel(draft)).toBe('Indonesia');
  });

  it('is empty when neither is named', () => {
    const draft = { ...toEditDraft(makeTrip()), destinationCity: '', destinationCountry: '' };

    expect(destinationLabel(draft)).toBe('');
  });
});

describe('addPickedActivity', () => {
  /** An attraction as the explorer hands it over. */
  function attraction(overrides: Partial<Activity> = {}): Activity {
    return {
      id: 'xid_cascade',
      title: 'Cascade Complex',
      category: 'culture',
      description: 'Monuments · 0.8 km from centre',
      price: 0,
      rating: 4,
      reviews: 0,
      image: '/cascade.jpg',
      coordinates: { lat: 40.19, lng: 44.51 },
      ...overrides,
    };
  }

  it('carries everything the explorer knows onto the itinerary entry', () => {
    const draft = addPickedActivity(toEditDraft(makeTrip()), 'day-1', attraction(), '09:00');
    const added = draft.itinerary[0].activities[0];

    expect(added).toMatchObject({
      time: '09:00',
      title: 'Cascade Complex',
      description: 'Monuments · 0.8 km from centre',
      category: 'culture',
      image: '/cascade.jpg',
      sourceActivityId: 'xid_cascade',
      coordinates: { lat: 40.19, lng: 44.51 },
    });
  });

  it('places the entry in time order', () => {
    // The stored day holds one activity at 14:00.
    const draft = addPickedActivity(toEditDraft(makeTrip()), 'day-1', attraction(), '09:00');

    expect(draft.itinerary[0].activities.map((entry) => entry.time)).toEqual(['09:00', '14:00']);
  });

  it('appends when it is the latest of the day', () => {
    const draft = addPickedActivity(toEditDraft(makeTrip()), 'day-1', attraction(), '18:30');

    expect(draft.itinerary[0].activities.map((entry) => entry.time)).toEqual(['14:00', '18:30']);
  });

  // The reason this inserts rather than sorting: a day under edit is routinely
  // out of order, and reordering it would undo the reader's own arrangement.
  it('does not reorder a day that was already out of order', () => {
    const base = toEditDraft(makeTrip());
    const unordered = {
      ...base,
      itinerary: base.itinerary.map((day) =>
        day.id === 'day-1'
          ? {
              ...day,
              activities: [
                { ...day.activities[0], id: 'act-late', time: '16:00' },
                { ...day.activities[0], id: 'act-early', time: '08:00' },
              ],
            }
          : day,
      ),
    };

    const draft = addPickedActivity(unordered, 'day-1', attraction(), '17:00');
    const [first, second, third] = draft.itinerary[0].activities;

    // The two existing rows keep their positions; the pick lands before the
    // first row later than it.
    expect(first.id).toBe('act-late');
    expect(second.id).toBe('act-early');
    expect(third.sourceActivityId).toBe('xid_cascade');
  });

  it('falls back to the default time when none is given', () => {
    const draft = addPickedActivity(toEditDraft(makeTrip()), 'day-1', attraction(), '   ');

    expect(draft.itinerary[0].activities[0].time).toBe(DEFAULT_ACTIVITY_TIME);
  });

  it('leaves a price off when the source has none', () => {
    const draft = addPickedActivity(toEditDraft(makeTrip()), 'day-1', attraction(), '09:00');

    expect(draft.itinerary[0].activities[0].priceEstimate).toBeUndefined();
  });

  it('refuses a second pick of the same place, by reference', () => {
    const once = addPickedActivity(toEditDraft(makeTrip()), 'day-1', attraction(), '09:00');
    const twice = addPickedActivity(once, 'day-1', attraction(), '11:00');

    expect(twice).toBe(once);
  });

  it('allows the same place on a different day', () => {
    const base = toEditDraft(makeTrip());
    const twoDays = {
      ...base,
      itinerary: [
        ...base.itinerary,
        {
          id: 'day-2',
          dayNumber: 2,
          date: '2027-05-21',
          destination: 'Ubud',
          summary: '',
          activities: [],
        },
      ],
    };

    const draft = addPickedActivity(
      addPickedActivity(twoDays, 'day-1', attraction(), '09:00'),
      'day-2',
      attraction(),
      '09:00',
    );

    expect(draft.itinerary[1].activities).toHaveLength(1);
  });

  it('ignores an unknown day', () => {
    const draft = toEditDraft(makeTrip());

    expect(addPickedActivity(draft, 'day-9', attraction(), '09:00')).toEqual(draft);
  });

  it('never mutates the draft it was given', () => {
    const draft = toEditDraft(makeTrip());

    addPickedActivity(draft, 'day-1', attraction(), '09:00');

    expect(draft.itinerary[0].activities).toHaveLength(1);
  });

  // The pick has to reach storage the ordinary way, through the save path.
  it('makes the draft dirty and rides along in the patch', () => {
    const trip = makeTrip();
    const draft = addPickedActivity(toEditDraft(trip), 'day-1', attraction(), '09:00');

    expect(isDirty(trip, draft)).toBe(true);
    expect(toPatch(trip, draft).itinerary).toEqual(draft.itinerary);
  });
});
