/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Trip } from '../../../types/trip.types';
import { STORAGE_KEYS, storageService } from '../../../services/localStorage.service';
import { searchService } from '../../../services/search.service';
import { BookingsPage } from './BookingsPage';

/**
 * What the screen says it is filling for, and what it actually searches.
 *
 * These were allowed to disagree: the form seeded itself from the last flight
 * search, and the effect that re-baselines it only fires when the *trip*
 * changes — which never happens on a cold load, because the id is already
 * right on the first render. The result was a banner naming one trip above a
 * form showing another's route, dates and party.
 */

const TRIP: Trip = {
  id: 'trip_maldives',
  title: 'Maldives on a Budget',
  destination: 'Maafushi',
  destinationCity: 'Maafushi',
  destinationCountry: 'Maldives',
  startDate: '2027-09-14',
  endDate: '2027-09-16',
  travellers: 1,
  coverImage: '/x.jpg',
  itinerary: [],
  createdAt: 'x',
  updatedAt: 'x',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/bookings?tripId=${TRIP.id}`]}>
      <BookingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  storageService.set(STORAGE_KEYS.trips, [TRIP]);

  // A leftover search for an entirely different trip — the state this bug
  // needed to show itself.
  vi.spyOn(searchService, 'getLastFlightSearch').mockReturnValue({
    tripType: 'round-trip',
    from: 'AUH',
    to: 'EVN',
    departDate: '2027-09-02',
    returnDate: '2027-09-06',
    travellers: 2,
  });
});

describe('BookingsPage', () => {
  it('opens on the trip it says it is filling for, not the last search', () => {
    renderPage();

    // The banner and the form have to agree on the first paint.
    expect(screen.getByText(TRIP.title)).toBeInTheDocument();
    expect(screen.getByLabelText(/depart/i)).toHaveValue('2027-09-14');
    expect(screen.getByLabelText(/return/i)).toHaveValue('2027-09-16');
  });

  it('takes the party from the trip rather than the stale search', () => {
    renderPage();

    expect(screen.getByLabelText(/travellers/i)).toHaveValue('1');
  });

  it('still keeps the origin from the last search', () => {
    renderPage();

    // A trip knows where you are going, never where you leave from — this is
    // the one field the search is allowed to win.
    //
    // `getAllBy`, because the screen carries two "From" fields: this form's,
    // and the per-leg one the Flights tab adds underneath it.
    expect(screen.getAllByLabelText(/^from/i)[0]).toHaveValue('AUH');
  });

  it('falls back to the last search when filling for no trip', () => {
    render(
      <MemoryRouter initialEntries={['/bookings?tripId=none']}>
        <BookingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/depart/i)).toHaveValue('2027-09-02');
  });
});
