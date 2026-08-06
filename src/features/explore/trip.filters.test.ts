import { describe, expect, it } from 'vitest';
import type { Trip } from '../../types/trip.types';
import { addableTrips, canAddToTrip, tripCountry } from './trip.filters';

/**
 * Which trips a place from the explorer may go on.
 *
 * The rule blocks only what it can prove: an unknown country on either side is
 * no evidence, and treating it as a mismatch would lock people out of trips
 * saved before we recorded one. The tests that matter most are therefore the
 * ones where something is missing.
 */

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    destinationCity: 'Yerevan',
    destinationCountry: 'Armenia',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [],
    createdAt: '2027-08-01T00:00:00.000Z',
    updatedAt: '2027-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('canAddToTrip', () => {
  it('refuses a place in another country', () => {
    expect(canAddToTrip(trip(), 'Djibouti')).toEqual({
      addable: false,
      reason: 'goes to Armenia',
    });
  });

  it('allows a place in the trip’s own country', () => {
    expect(canAddToTrip(trip(), 'Armenia').addable).toBe(true);
  });

  it('allows a day trip out of the city, which is normal travel', () => {
    // Hakone is 80km from Tokyo and a different prefecture; Dilijan is an hour
    // from Yerevan. Matching on city would reject both.
    const tokyo = trip({ destination: 'Tokyo', destinationCity: 'Tokyo', destinationCountry: 'Japan' });

    expect(canAddToTrip(tokyo, 'Japan').addable).toBe(true);
  });

  it('ignores case and stray spacing', () => {
    expect(canAddToTrip(trip({ destinationCountry: ' armenia ' }), 'Armenia').addable).toBe(true);
  });

  it('allows anything onto a trip saved before we recorded a country', () => {
    // These carry only `destination: "Yerevan"`. Blocking on a country we
    // never stored would make the explorer useless for them.
    expect(canAddToTrip(trip({ destinationCountry: undefined }), 'Djibouti').addable).toBe(true);
  });

  it('allows anything when the place’s country is unknown', () => {
    expect(canAddToTrip(trip(), null).addable).toBe(true);
  });

  it('treats a blank country as unknown rather than as a name', () => {
    expect(canAddToTrip(trip({ destinationCountry: '   ' }), 'Djibouti').addable).toBe(true);
    expect(canAddToTrip(trip(), '   ').addable).toBe(true);
  });
});

describe('tripCountry', () => {
  it('reads the country when there is one', () => {
    expect(tripCountry(trip())).toBe('Armenia');
  });

  it('is null for a trip that never recorded one', () => {
    expect(tripCountry(trip({ destinationCountry: undefined }))).toBeNull();
    expect(tripCountry(trip({ destinationCountry: '  ' }))).toBeNull();
  });
});

describe('addableTrips', () => {
  const armenia = trip({ id: 'trip_am', destinationCountry: 'Armenia' });
  const japan = trip({ id: 'trip_jp', destinationCountry: 'Japan' });
  const legacy = trip({ id: 'trip_old', destinationCountry: undefined });

  it('keeps only the trips that go to the same country', () => {
    expect(addableTrips([armenia, japan, legacy], 'Japan').map((t) => t.id)).toEqual([
      'trip_jp',
      'trip_old',
    ]);
  });

  it('keeps everything when the place’s country is unknown', () => {
    expect(addableTrips([armenia, japan, legacy], null)).toHaveLength(3);
  });

  it('can come back empty, which is what the dialog explains', () => {
    expect(addableTrips([armenia, japan], 'Djibouti')).toEqual([]);
  });
});
