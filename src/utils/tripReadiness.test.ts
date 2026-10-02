import { describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { tripReadiness } from './tripReadiness';

const trip: Trip = {
  id: 'trip_1', title: 'Portugal', destination: 'Lisbon', destinationCountry: 'Portugal',
  startDate: '2027-06-01', endDate: '2027-06-04', travellers: 2, coverImage: '',
  itinerary: [{
    id: 'day_1', dayNumber: 1, date: '2027-06-01', destination: 'Lisbon', summary: '',
    activities: [{ id: 'act_1', time: '10:00', title: 'Museum', description: '', category: 'culture' }],
  }], createdAt: 'x', updatedAt: 'x',
};

const makeBooking = (overrides: Partial<Booking>): Booking => ({
  id: 'booking_1', tripId: 'trip_1', kind: 'flight', status: 'booked', title: 'Flight',
  date: '2027-06-01', reference: 'AB123', createdAt: 'x', updatedAt: 'x', ...overrides,
});

describe('tripReadiness', () => {
  it('links each incomplete item to the relevant trip workflow', () => {
    const items = tripReadiness({ ...trip, itinerary: [{ ...trip.itinerary[0], activities: [] }] }, []);
    expect(items.find((item) => item.id === 'itinerary')).toMatchObject({
      complete: false,
      href: '/trips/trip_1?tab=itinerary',
    });
    expect(items.find((item) => item.id === 'flight')?.href).toBe('/bookings?tripId=trip_1&tab=flights');
    expect(items.find((item) => item.id === 'stay')?.complete).toBe(false);
  });

  it('counts stay coverage and confirmation references only when bookings evidence them', () => {
    const items = tripReadiness(trip, [
      makeBooking({ id: 'flight', kind: 'flight' }),
      makeBooking({ id: 'stay', kind: 'hotel', date: '2027-06-01', endDate: '2027-06-04' }),
    ]);
    expect(items.find((item) => item.id === 'flight')?.complete).toBe(true);
    expect(items.find((item) => item.id === 'stay')?.complete).toBe(true);
    expect(items.find((item) => item.id === 'confirmation')?.complete).toBe(true);
  });

  it('calls out booked reservations with missing references', () => {
    const item = tripReadiness(trip, [makeBooking({ reference: '' })])
      .find((candidate) => candidate.id === 'confirmation');
    expect(item).toMatchObject({ complete: false, detail: 'At least one booked item needs a reference number' });
  });
});
