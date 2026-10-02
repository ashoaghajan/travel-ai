/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Trip } from '../../../types/trip.types';
import { TripReadinessChecklist } from './TripReadinessChecklist';

const trip: Trip = {
  id: 'trip_1', title: 'Lisbon week', destination: 'Lisbon', startDate: '2027-06-01',
  endDate: '2027-06-04', travellers: 2, coverImage: '', itinerary: [], createdAt: 'x', updatedAt: 'x',
};

describe('TripReadinessChecklist', () => {
  it('shows a progress summary and actions to address gaps', () => {
    render(<MemoryRouter><TripReadinessChecklist trip={trip} bookings={[]} today="2027-05-30" /></MemoryRouter>);

    expect(screen.getByRole('progressbar', { name: 'Trip readiness' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByRole('link', { name: 'Complete: Flight added' })).toHaveAttribute(
      'href', '/bookings?tripId=trip_1&tab=flights',
    );
    expect(screen.getByRole('link', { name: 'Complete: Accommodation covered' })).toHaveAttribute(
      'href', '/bookings?tripId=trip_1&tab=hotels',
    );
  });

  it('is hidden after a trip has started', () => {
    const { container } = render(
      <MemoryRouter><TripReadinessChecklist trip={trip} bookings={[]} today="2027-06-02" /></MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });
});
