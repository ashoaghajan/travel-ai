import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { TripBrief } from '../types/planner.types';
import { DEFAULT_PREFERENCES } from './itinerary.planner';
import { bookingService } from './booking.service';
import { geocodeService } from './geocode.service';
import * as metro from './metro.service';
import { chooseStay, resolvePlanningContext } from './planning.context';

/**
 * Finding what the two location rules measure against.
 *
 * The rules themselves are tested in `itinerary.planner.test.ts`; this is the
 * half that talks to the network, and its job is to fail quietly. Every
 * lookup here can come back empty, and every empty answer has to leave the
 * planner in the state it would have been in without the preference — not in
 * one that excludes everything.
 */

const TBILISI = { lat: 41.7151, lng: 44.7833, name: 'Tbilisi' };
/** About 2 km from the centre — a hotel somebody could plausibly be in. */
const HOTEL = { lat: 41.733, lng: 44.7833, name: 'Rooms Hotel' };
/** Paris, which is not Tbilisi and must never be mistaken for its hotel. */
const ELSEWHERE = { lat: 48.8566, lng: 2.3522, name: 'Grand Hotel' };

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    tripId: null,
    kind: 'hotel',
    status: 'booked',
    title: 'Rooms Hotel',
    date: '2027-06-01',
    reference: '',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function brief(overrides: Partial<TripBrief> = {}): TripBrief {
  return {
    destination: 'Tbilisi',
    startDate: '2027-06-01',
    days: 3,
    travellers: 2,
    preferences: DEFAULT_PREFERENCES,
    ...overrides,
  };
}

function preferences(overrides: Partial<TripBrief['preferences']>) {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chooseStay', () => {
  it('finds nothing among bookings that are not stays', () => {
    expect(chooseStay([booking({ kind: 'flight' })], '2027-06-01')).toBeNull();
    expect(chooseStay([booking({ kind: 'activity' })], '2027-06-01')).toBeNull();
  });

  /*
   * A stay filed against another trip belongs to that trip. Only an
   * unassigned one can be evidence about a trip that does not exist yet.
   */
  it('ignores a stay already attached to a trip', () => {
    expect(chooseStay([booking({ tripId: 'trip_1' })], '2027-06-01')).toBeNull();
  });

  it('ignores a stay with no name to geocode', () => {
    expect(chooseStay([booking({ title: '   ' })], '2027-06-01')).toBeNull();
  });

  it('takes the check-in nearest the start of the trip', () => {
    const near = booking({ id: 'near', date: '2027-06-02' });
    const far = booking({ id: 'far', date: '2027-09-01' });

    expect(chooseStay([far, near], '2027-06-01')?.id).toBe('near');
    expect(chooseStay([near, far], '2027-06-01')?.id).toBe('near');
  });

  it('still takes an undated stay when it is the only one', () => {
    expect(chooseStay([booking({ date: '' })], '2027-06-01')?.id).toBe('booking-1');
  });

  /* A brief with no usable start date cannot rank stays, so the first stands. */
  it('keeps the first stay when the trip has no start date to compare against', () => {
    const first = booking({ id: 'first', date: '2027-06-02' });
    const second = booking({ id: 'second', date: '2027-06-05' });

    expect(chooseStay([first, second], '')?.id).toBe('first');
  });

  it('prefers a dated stay over an undated one', () => {
    const dated = booking({ id: 'dated', date: '2027-06-02' });
    const undated = booking({ id: 'undated', date: '' });

    expect(chooseStay([undated, dated], '2027-06-01')?.id).toBe('dated');
  });
});

describe('resolvePlanningContext', () => {
  it('looks nothing up when neither rule is on', async () => {
    const locate = vi.spyOn(geocodeService, 'locate');
    const stations = vi.spyOn(metro, 'getMetroStations');

    await expect(resolvePlanningContext(brief())).resolves.toEqual({
      base: undefined,
      metroStations: undefined,
    });

    // The ordinary trip, and the reason both rules cost nothing until asked for.
    expect(locate).not.toHaveBeenCalled();
    expect(stations).not.toHaveBeenCalled();
  });

  it('bases the trip on a booked stay when one is near the destination', async () => {
    vi.spyOn(bookingService, 'getBookings').mockResolvedValue([booking()]);
    vi.spyOn(geocodeService, 'locate').mockImplementation(async (name: string) =>
      name === 'Tbilisi' ? TBILISI : HOTEL,
    );

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base).toEqual({
      coordinates: { lat: HOTEL.lat, lng: HOTEL.lng, name: 'Rooms Hotel' },
      source: 'stay',
    });
  });

  it('falls back to the centre when nothing is booked', async () => {
    vi.spyOn(bookingService, 'getBookings').mockResolvedValue([]);
    vi.spyOn(geocodeService, 'locate').mockResolvedValue(TBILISI);

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base?.source).toBe('centre');
  });

  /*
   * The check that stops a name from being a passport. "Grand Hotel" is a
   * hotel in most countries, and a Paris booking made the centre of a Tbilisi
   * trip would exclude every place in it.
   */
  it('refuses a stay that geocodes to another country', async () => {
    vi.spyOn(bookingService, 'getBookings').mockResolvedValue([
      booking({ title: 'Grand Hotel' }),
    ]);
    vi.spyOn(geocodeService, 'locate').mockImplementation(async (name: string) =>
      name === 'Tbilisi' ? TBILISI : ELSEWHERE,
    );

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base?.source).toBe('centre');
  });

  it('falls back to the centre when the stay cannot be placed', async () => {
    vi.spyOn(bookingService, 'getBookings').mockResolvedValue([booking()]);
    vi.spyOn(geocodeService, 'locate').mockImplementation(async (name: string) =>
      name === 'Tbilisi' ? TBILISI : null,
    );

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base?.source).toBe('centre');
  });

  it('falls back to the centre when placing the stay throws', async () => {
    vi.spyOn(bookingService, 'getBookings').mockResolvedValue([booking()]);
    vi.spyOn(geocodeService, 'locate').mockImplementation(async (name: string) => {
      if (name === 'Tbilisi') return TBILISI;
      throw new Error('quota');
    });

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base?.source).toBe('centre');
  });

  it('gives up on a base entirely when the destination cannot be geocoded', async () => {
    vi.spyOn(geocodeService, 'locate').mockResolvedValue(null);

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    // No base at all, which is what turns the radius off rather than applying
    // it around a point nobody found.
    expect(context.base).toBeUndefined();
  });

  it('survives the bookings failing to load', async () => {
    vi.spyOn(bookingService, 'getBookings').mockRejectedValue(new Error('offline'));
    vi.spyOn(geocodeService, 'locate').mockResolvedValue(TBILISI);

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base?.source).toBe('centre');
  });

  it('survives the geocoder throwing', async () => {
    vi.spyOn(geocodeService, 'locate').mockRejectedValue(new Error('no key'));

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ maxDistanceFromHotelKm: 3 }) }),
    );

    expect(context.base).toBeUndefined();
  });

  it('fetches stations only for the metro rule', async () => {
    const stations = vi
      .spyOn(metro, 'getMetroStations')
      .mockResolvedValue([{ lat: 41.72, lng: 44.79 }]);
    const locate = vi.spyOn(geocodeService, 'locate');

    const context = await resolvePlanningContext(
      brief({ preferences: preferences({ nearMetroOnly: true }) }),
    );

    expect(context.metroStations).toEqual([{ lat: 41.72, lng: 44.79 }]);
    expect(stations).toHaveBeenCalledWith('Tbilisi');
    // The other rule is off, so no base is looked up for it.
    expect(locate).not.toHaveBeenCalled();
  });
});
