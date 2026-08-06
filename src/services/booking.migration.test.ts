/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { migrateLegacyTripBookings } from './booking.migration';

const LEGACY = {
  id: 'bkg-old',
  kind: 'hotel' as const,
  title: 'Hotel Indigo',
  date: '2027-05-20',
  reference: 'BK-4471',
  price: 420,
  createdAt: '2027-01-01T00:00:00.000Z',
};

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Bali Adventure',
    destination: 'Bali',
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

function storedTrips(): Trip[] {
  return storageService.get<Trip[]>(STORAGE_KEYS.trips, []);
}

function storedBookings(): Booking[] {
  return storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);
}

beforeEach(() => {
  storageService.remove(STORAGE_KEYS.trips);
  storageService.remove(STORAGE_KEYS.bookings);
});

describe('migrateLegacyTripBookings', () => {
  it('does nothing when no trip carries the old field', () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip()]);

    migrateLegacyTripBookings();

    expect(storedBookings()).toEqual([]);
  });

  it('lifts a legacy row onto its trip and strips the field', () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ bookings: [LEGACY] })]);

    migrateLegacyTripBookings();

    const [booking] = storedBookings();
    expect(booking).toMatchObject({
      id: 'bkg-old',
      tripId: 'trip_1',
      kind: 'hotel',
      title: 'Hotel Indigo',
      reference: 'BK-4471',
      price: 420,
    });
    // Typed in by hand under a heading saying what was booked — that is a claim
    // of a real reservation, not a shortlist entry.
    expect(booking.status).toBe('booked');
    expect(booking.createdAt).toBe(LEGACY.createdAt);
    expect(storedTrips()[0].bookings).toBeUndefined();
  });

  it('leaves updatedAt alone, so an edit in another tab is not discarded', () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ bookings: [LEGACY] })]);

    migrateLegacyTripBookings();

    expect(storedTrips()[0].updatedAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('runs twice without duplicating anything', () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ bookings: [LEGACY] })]);

    migrateLegacyTripBookings();
    // Second run has nothing left to find, but put the field back to prove the
    // id check is what dedupes rather than the field being gone.
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ bookings: [LEGACY] })]);
    migrateLegacyTripBookings();

    expect(storedBookings()).toHaveLength(1);
  });

  it('keeps bookings already in the store', () => {
    const existing: Booking = {
      id: 'bkg-new',
      tripId: 'trip_1',
      kind: 'flight',
      status: 'saved',
      title: 'Air Arabia',
      date: '',
      reference: '',
      createdAt: 'x',
      updatedAt: 'x',
    };
    storageService.set(STORAGE_KEYS.bookings, [existing]);
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ bookings: [LEGACY] })]);

    migrateLegacyTripBookings();

    expect(storedBookings()).toHaveLength(2);
    expect(storedBookings().some((booking) => booking.id === 'bkg-new')).toBe(true);
  });

  it('handles several trips at once and leaves untouched ones alone', () => {
    storageService.set(STORAGE_KEYS.trips, [
      makeTrip({ bookings: [LEGACY] }),
      makeTrip({ id: 'trip_2', bookings: [{ ...LEGACY, id: 'bkg-2', kind: 'ticket' }] }),
      makeTrip({ id: 'trip_3' }),
    ]);

    migrateLegacyTripBookings();

    expect(storedBookings()).toHaveLength(2);
    expect(storedBookings().map((booking) => booking.tripId).sort()).toEqual(['trip_1', 'trip_2']);
  });

  it('survives a store holding nonsense', () => {
    localStorage.setItem(STORAGE_KEYS.trips, 'not json at all');

    expect(() => migrateLegacyTripBookings()).not.toThrow();
    expect(storedBookings()).toEqual([]);
  });

  it('survives a trips value that is not an array', () => {
    storageService.set(STORAGE_KEYS.trips, { not: 'an array' });

    expect(() => migrateLegacyTripBookings()).not.toThrow();
  });

  it('ignores a trip whose bookings array is empty', () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ bookings: [] })]);

    migrateLegacyTripBookings();

    expect(storedBookings()).toEqual([]);
  });
});
