/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Flight } from '../../../types/travel.types';
import type { BookingContext } from '../../../types/travel.types';
import type { Booking } from '../../../types/booking.types';
import { bookingService } from '../../../services/booking.service';
import { flightService } from '../../../services/flight.service';
import { seedBookings } from '../../../test/seedBookings';
import { BookingBrowser } from './BookingBrowser';

/**
 * Booking a round trip, in the two steps it actually takes.
 *
 * The route is no longer asked for here — it comes from the search above this
 * component — so what has to hold is that each step searches the right way
 * round, and that taking a fare for the way out moves the reader to the way
 * home rather than leaving them on a list they are done with.
 */

const CONTEXT: BookingContext = {
  tripType: 'round-trip',
  originCode: 'AUH',
  destinationCode: 'EVN',
  destinationCity: 'Yerevan',
  destinationCountry: 'Armenia',
  departDate: '2026-09-14',
  returnDate: '2026-09-19',
  travellers: 2,
};

function fare(id: string, from: string, to: string): Flight {
  return {
    id,
    airline: 'Air Arabia Abu Dhabi',
    from,
    to,
    departureTime: '9:05 AM',
    arrivalTime: '12:20 PM',
    departureDate: null,
    returnDate: null,
    duration: '3h 15m',
    stops: 0,
    price: 160,
    durationMinutes: 195,
    bookingUrl: 'https://partner.example/fare',
  };
}

let searchFlights: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();

  // jsdom does not implement the native dialog methods.
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  searchFlights = vi
    .spyOn(flightService, 'searchFlights')
    .mockImplementation(async (query) => ({
      results: [fare(`fare_${query.from}_${query.to}`, query.from, query.to)],
      source: 'live',
      quotedAt: '2026-08-11T09:48:00.000Z',
    }));
});

function renderBrowser() {
  return render(
    <MemoryRouter>
      <BookingBrowser
        context={CONTEXT}
        tripId={null}
        activeTab="flights"
        onTabChange={() => {}}
        idPrefix="test"
      />
    </MemoryRouter>,
  );
}

describe('BookingBrowser flight steps', () => {
  it('searches the outbound direction first, one way', async () => {
    renderBrowser();

    await waitFor(() => expect(searchFlights).toHaveBeenCalled());

    expect(searchFlights).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'AUH',
        to: 'EVN',
        departDate: '2026-09-14',
        // Each leg is its own fare; a return date would bring back a bundle.
        tripType: 'one-way',
        returnDate: undefined,
      }),
    );
  });

  it('searches the way home when the return step is chosen', async () => {
    renderBrowser();
    await waitFor(() => expect(searchFlights).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /^return:/i }));

    await waitFor(() =>
      expect(searchFlights).toHaveBeenCalledWith(
        expect.objectContaining({
          // Reversed with nobody having said so — this is the whole change.
          from: 'EVN',
          to: 'AUH',
          departDate: '2026-09-19',
        }),
      ),
    );
  });

  it('moves on to the return once the outbound fare is taken', async () => {
    renderBrowser();
    await waitFor(() => expect(searchFlights).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /^outbound:/i })).toHaveAttribute(
      'aria-current',
      'step',
    );

    // "Book" leaves for the partner; the reader who comes back wants the way
    // home, not the flight they just paid for.
    await userEvent.click(screen.getByRole('link', { name: /^book /i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^return:/i })).toHaveAttribute(
        'aria-current',
        'step',
      ),
    );

    expect(screen.getByRole('button', { name: /outbound.*chosen/i })).toBeInTheDocument();
  });

  it('moves on when the outbound is filed against the trip', async () => {
    await seedBookings([]);
    const created = vi.spyOn(bookingService, 'create').mockImplementation(
      async (draft) =>
        ({
          ...draft,
          id: 'booking_1',
          createdAt: 'x',
          updatedAt: 'x',
        }) as Booking,
    );

    renderBrowser();
    await waitFor(() => expect(searchFlights).toHaveBeenCalled());

    await userEvent.click(screen.getAllByRole('button', { name: 'Add to trip' })[0]);

    // The dialog's own confirm shares its label with the card's button.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to trip' }));

    await waitFor(() => expect(created).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^return:/i })).toHaveAttribute(
        'aria-current',
        'step',
      ),
    );
  });

  it('stays put when the dialog is opened and backed out of', async () => {
    await seedBookings([]);
    renderBrowser();
    await waitFor(() => expect(searchFlights).toHaveBeenCalled());

    await userEvent.click(screen.getAllByRole('button', { name: 'Add to trip' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Opening the dialog is not choosing the fare in it. Advancing here would
    // be the app deciding on the reader's behalf.
    expect(screen.getByRole('button', { name: /^outbound:/i })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.queryByRole('button', { name: /outbound.*chosen/i })).not.toBeInTheDocument();
  });

  it('goes no further than the outbound on a one-way search', async () => {
    render(
      <MemoryRouter>
        <BookingBrowser
          context={{ ...CONTEXT, tripType: 'one-way', returnDate: null }}
          tripId={null}
          activeTab="flights"
          onTabChange={() => {}}
          idPrefix="test"
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(searchFlights).toHaveBeenCalled());

    // No steps at all, and taking the fare cannot advance to a leg that the
    // search does not describe.
    expect(screen.queryByRole('button', { name: /^return:/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: /^book /i }));

    expect(screen.queryByRole('button', { name: /^return:/i })).not.toBeInTheDocument();
  });
});
