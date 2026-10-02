/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Booking } from '../../../types/booking.types';
import type { Trip } from '../../../types/trip.types';
import { TripAtAGlance } from './TripAtAGlance';

const trip: Trip = {
  id: 'trip_1',
  title: 'Lisbon week',
  destination: 'Lisbon',
  startDate: '2027-06-01',
  endDate: '2027-06-04',
  travellers: 2,
  coverImage: '',
  itinerary: [{
    id: 'day_1',
    dayNumber: 1,
    date: '2027-06-01',
    destination: 'Lisbon',
    summary: '',
    activities: [
      { id: 'early', time: '09:00', title: 'Breakfast', description: '', category: 'food' },
      { id: 'later', time: '15:30', title: 'Riverside walk', description: '', category: 'nature' },
    ],
  }],
  createdAt: 'x',
  updatedAt: 'x',
};

const booking: Booking = {
  id: 'bkg_1', tripId: 'trip_1', kind: 'flight', status: 'booked', title: 'Flight to Lisbon',
  date: '2027-06-01', reference: 'AB123', createdAt: 'x', updatedAt: 'x',
};

function renderAt(today: string, currentTime?: string) {
  return render(
    <MemoryRouter>
      <TripAtAGlance trip={trip} bookings={[booking]} today={today} currentTime={currentTime} />
    </MemoryRouter>,
  );
}

describe('TripAtAGlance', () => {
  it('shows countdown, next activity, booking, and trip-specific quick actions before travel', () => {
    renderAt('2027-05-30');

    expect(screen.getByRole('heading', { name: 'Your trip starts in 2 days' })).toBeInTheDocument();
    expect(screen.getByText('09:00 · Breakfast')).toBeInTheDocument();
    expect(screen.getByText('Flight · Flight to Lisbon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage bookings' })).toHaveAttribute('href', '/bookings?tripId=trip_1');
    expect(screen.getByRole('link', { name: 'Find places' })).toHaveAttribute('href', '/activities?tripId=trip_1');
  });

  it('skips today’s activities that have already passed', () => {
    renderAt('2027-06-01', '12:00');
    expect(screen.getByText('15:30 · Riverside walk')).toBeInTheDocument();
    expect(screen.queryByText('09:00 · Breakfast')).not.toBeInTheDocument();
  });

  it('offers a helpful empty schedule state', () => {
    renderAt('2027-06-05');
    expect(screen.getByRole('heading', { name: 'Trip completed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No upcoming days' })).toBeInTheDocument();
  });
});
