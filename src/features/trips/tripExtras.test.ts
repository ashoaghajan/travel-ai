import { describe, expect, it } from 'vitest';
import type { Trip, TripNote } from '../../types/trip.types';
import {
  addNote,
  isDirty,
  removeNote,
  toEditDraft,
  toPatch,
  updateNote,
  validate,
} from './editTrip';

/**
 * Notes — the list the trip page's Notes tab edits. The itinerary rules are
 * covered in `editTrip.test.ts`; this covers only what notes added.
 *
 * Bookings were here too until they moved to their own store; see
 * `booking.service.test.ts`.
 */

const NOTE: TripNote = {
  id: 'note-1',
  text: 'Pack adapters',
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
};

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Bali Adventure',
    destination: 'Bali',
    // Set explicitly: `toEditDraft` backfills it from `destination`, which
    // would make every draft here read as a destination change.
    destinationCity: 'Bali',
    startDate: '2027-05-20',
    endDate: '2027-05-26',
    travellers: 2,
    coverImage: '/bali.jpg',
    itinerary: [],
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('toEditDraft', () => {
  it('reads a trip saved before notes existed as an empty list', () => {
    expect(toEditDraft(makeTrip()).notes).toEqual([]);
  });

  it('deep-copies them, so an abandoned edit cannot leak into the store', () => {
    const trip = makeTrip({ notes: [NOTE] });
    const draft = toEditDraft(trip);

    draft.notes[0].text = 'Changed';

    expect(trip.notes?.[0].text).toBe('Pack adapters');
  });
});

describe('notes', () => {
  it('appends a blank note stamped now', () => {
    const draft = addNote(toEditDraft(makeTrip()));

    expect(draft.notes).toHaveLength(1);
    expect(draft.notes[0].text).toBe('');
    expect(draft.notes[0].createdAt).toBe(draft.notes[0].updatedAt);
  });

  it('moves updatedAt when the text actually changes', () => {
    const trip = makeTrip({ notes: [NOTE] });
    const draft = updateNote(toEditDraft(trip), 'note-1', 'Pack adapters and a raincoat');

    expect(draft.notes[0].text).toBe('Pack adapters and a raincoat');
    expect(draft.notes[0].updatedAt).not.toBe(NOTE.updatedAt);
  });

  it('leaves updatedAt alone when the text is unchanged', () => {
    const trip = makeTrip({ notes: [NOTE] });
    const draft = updateNote(toEditDraft(trip), 'note-1', 'Pack adapters');

    expect(draft.notes[0].updatedAt).toBe(NOTE.updatedAt);
  });

  it('removes by id', () => {
    const trip = makeTrip({ notes: [NOTE] });

    expect(removeNote(toEditDraft(trip), 'note-1').notes).toEqual([]);
  });

  it('refuses a note with nothing written in it', () => {
    const draft = addNote(toEditDraft(makeTrip()));
    const errors = validate(draft);

    expect(errors.notes?.[draft.notes[0].id]).toBe('Write the note, or remove it.');
  });
});

describe('isDirty', () => {
  it('is false for a trip with no notes', () => {
    const trip = makeTrip();

    expect(isDirty(trip, toEditDraft(trip))).toBe(false);
  });

  it('is false for a trip that already has them', () => {
    const trip = makeTrip({ notes: [NOTE] });

    expect(isDirty(trip, toEditDraft(trip))).toBe(false);
  });

  it('notices an added note', () => {
    const trip = makeTrip();

    expect(isDirty(trip, addNote(toEditDraft(trip)))).toBe(true);
  });
});

describe('toPatch', () => {
  it('sends nothing when the notes did not change', () => {
    const trip = makeTrip({ notes: [NOTE] });

    expect(toPatch(trip, toEditDraft(trip))).toEqual({});
  });

  it('sends the whole list once one note changed', () => {
    const trip = makeTrip({ notes: [NOTE] });
    const draft = updateNote(toEditDraft(trip), 'note-1', 'Pack adapters and plugs');
    const patch = toPatch(trip, draft);

    expect(patch.notes).toHaveLength(1);
    expect(patch.notes?.[0].text).toBe('Pack adapters and plugs');
  });

  it('trims a note', () => {
    const trip = makeTrip({ notes: [NOTE] });
    const draft = updateNote(toEditDraft(trip), 'note-1', '  Pack adapters and plugs  ');

    expect(toPatch(trip, draft).notes?.[0].text).toBe('Pack adapters and plugs');
  });
});
