/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Trip } from '../../../types/trip.types';
import { searchService } from '../../../services/search.service';
import { BookingsPage } from './BookingsPage';
import { seedTrips } from '../../../test/seedTrips';
import { currentCityAirportService } from '../../../services/currentCityAirport.service';
import { airportService } from '../../../services/airport.service';
import type { Airport } from '../../../types/travel.types';

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

beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(currentCityAirportService, 'locate').mockResolvedValue(null);
  await seedTrips([TRIP]);

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
    // Anchored: the Flights tab's return *step* is labelled "Return: …" too,
    // and it is a button rather than the date this asserts.
    expect(screen.getByLabelText('Return')).toHaveValue('2027-09-16');
  });

  it('takes the party from the trip rather than the stale search', () => {
    renderPage();

    expect(screen.getByLabelText(/travellers/i)).toHaveValue('1');
  });

  it('keeps the origin from the last search when location is unavailable', () => {
    renderPage();

    // A trip knows where you are going, never where you leave from — this is
    // the one field the search is allowed to win.
    //
    // `getBy`, singular: the screen has exactly one "From" now. The Flights
    // tab used to add a second one under its leg toggle, and the whole point
    // of the stepper replacing it is that the route is asked for once.
    expect(screen.getByLabelText(/^from/i)).toHaveValue('AUH');
  });

  it('falls back to the last search when filling for no trip', () => {
    render(
      <MemoryRouter initialEntries={['/bookings?tripId=none']}>
        <BookingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/depart/i)).toHaveValue('2027-09-02');
  });

  it('defaults From to the current city without resetting edits to other fields', async () => {
    let finish!: (airport: Airport) => void;
    vi.mocked(currentCityAirportService.locate).mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const airport: Airport = {
      code: 'EVN', city: 'Yerevan', name: 'Zvartnots', countryCode: 'AM',
    };
    airportService.remember(airport);
    // No trip retains the saved arrival code, so the priced route is visible.
    vi.mocked(searchService.getLastFlightSearch).mockReturnValue({
      tripType: 'round-trip', from: 'AUH', to: 'DPS',
      departDate: '2027-09-14', returnDate: '2027-09-16', travellers: 2,
    });
    render(
      <MemoryRouter initialEntries={['/bookings?tripId=none']}>
        <BookingsPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2027-09-15' } });
    await act(async () => finish(airport));
    await waitFor(() => expect(screen.getByLabelText(/^from/i)).toHaveValue('EVN - Yerevan'));
    expect(screen.getByLabelText(/depart/i)).toHaveValue('2027-09-15');
    expect(screen.getByLabelText(/travellers/i)).toHaveValue('2');
    expect(screen.getByRole('button', { name: /outbound: EVN/i })).toBeInTheDocument();
  });
});
