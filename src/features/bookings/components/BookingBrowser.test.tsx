/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Flight, Hotel } from '../../../types/travel.types';
import type { BookingContext } from '../../../types/travel.types';
import type { Booking } from '../../../types/booking.types';
import { bookingService } from '../../../services/booking.service';
import { flightService } from '../../../services/flight.service';
import { hotelService } from '../../../services/hotel.service';
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

/**
 * Sorting and narrowing the Hotels tab.
 *
 * The rules themselves are `@ai-travel/shared`'s and are tested there; what has
 * to hold here is that the controls are wired to the rows they claim to order,
 * and — the failure that would matter most — that narrowing to nothing leaves
 * the reader the controls to widen again.
 */
describe('BookingBrowser stays', () => {
  function stay(id: string, name: string, price: number | null, rating: number): Hotel {
    return {
      id,
      name,
      location: 'Yerevan',
      category: 'Hotel',
      rating,
      reviews: 100,
      pricePerNight: price,
      image: '',
      bookingUrl: 'https://partner.example/stay',
    };
  }

  const STAYS = [
    stay('h1', 'Middling House', 200, 4.1),
    stay('h2', 'Cheap Sleep', 90, 3.2),
    stay('h3', 'Grand Palace', 400, 4.8),
  ];

  function renderStays(results = STAYS) {
    vi.spyOn(hotelService, 'searchHotels').mockResolvedValue({
      results,
      source: 'live',
      quotedAt: '2026-08-11T09:48:00.000Z',
    });

    return render(
      <MemoryRouter>
        <BookingBrowser
          context={CONTEXT}
          tripId={null}
          activeTab="hotels"
          onTabChange={() => {}}
          idPrefix="test"
        />
      </MemoryRouter>,
    );
  }

  /**
   * Drag a handle to a figure.
   *
   * `fireEvent.change` rather than `userEvent`: a range input is dragged, not
   * typed into, and there is no pointer gesture in jsdom that moves a thumb to
   * a chosen value. Setting the value and firing the change is exactly what the
   * browser does at the end of a drag.
   */
  function setRange(to: { min?: number; max?: number }) {
    if (to.min !== undefined) {
      fireEvent.change(screen.getByRole('slider', { name: /minimum price per night/i }), {
        target: { value: String(to.min) },
      });
    }
    if (to.max !== undefined) {
      fireEvent.change(screen.getByRole('slider', { name: /maximum price per night/i }), {
        target: { value: String(to.max) },
      });
    }
  }

  /** The stay names on screen, in the order they are rendered. */
  function shownStays(): string[] {
    return screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent ?? '')
      .filter((name) => STAYS.some((s) => s.name === name));
  }

  it('leaves the provider order alone until asked', async () => {
    renderStays();

    await screen.findByText('Middling House');

    expect(shownStays()).toEqual(['Middling House', 'Cheap Sleep', 'Grand Palace']);
  });

  it('reorders by price, cheapest and dearest first', async () => {
    renderStays();
    await screen.findByText('Middling House');

    const sort = screen.getByRole('combobox', { name: /sort stays/i });

    await userEvent.selectOptions(sort, 'price-low');
    expect(shownStays()).toEqual(['Cheap Sleep', 'Middling House', 'Grand Palace']);

    await userEvent.selectOptions(sort, 'price-high');
    expect(shownStays()).toEqual(['Grand Palace', 'Middling House', 'Cheap Sleep']);
  });

  it('reorders by rating', async () => {
    renderStays();
    await screen.findByText('Middling House');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort stays/i }), 'rating');

    expect(shownStays()).toEqual(['Grand Palace', 'Middling House', 'Cheap Sleep']);
  });

  /*
   * The range runs across what these results actually cost, so the handles are
   * driven to real figures rather than to positions on an assumed scale.
   */
  it('hides the stays outside the price range, and says how many are left', async () => {
    renderStays();
    await screen.findByText('Middling House');

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));

    setRange({ max: 150 });

    expect(shownStays()).toEqual(['Cheap Sleep']);
    expect(screen.getByText(/showing 1 of 3 stays/i)).toBeInTheDocument();

    // And the other end of the same slider, which the old "up to" cap could
    // not express at all: a floor that hides the cheap room.
    setRange({ min: 150, max: 300 });

    expect(shownStays()).toEqual(['Middling House']);
  });

  it('reads handles resting on the ends as no filter at all', async () => {
    renderStays();
    await screen.findByText('Middling House');

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));

    const low = screen.getByRole('slider', { name: /minimum price per night/i });
    const high = screen.getByRole('slider', { name: /maximum price per night/i });

    // Untouched, both sit on the ends of the range the results cover.
    expect(shownStays()).toHaveLength(3);
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
    expect(Number(low.getAttribute('value'))).toBeLessThanOrEqual(90);
    expect(Number(high.getAttribute('value'))).toBeGreaterThanOrEqual(400);
  });

  it('hides the stays under a rating floor', async () => {
    renderStays();
    await screen.findByText('Middling House');

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /minimum rating/i }), '4.5');

    expect(shownStays()).toEqual(['Grand Palace']);
  });

  /*
   * The one that would hurt: filtering everything out used to be indis-
   * tinguishable from a search that found nothing, and taking the toolbar away
   * with the rows would strand a reader with no way to widen what they closed.
   */
  it('keeps the controls when the filters match nothing', async () => {
    renderStays();
    await screen.findByText('Middling House');

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));

    setRange({ max: 150 });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /minimum rating/i }), '4.5');

    expect(shownStays()).toEqual([]);
    expect(screen.getByText(/no stay matches those filters/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /sort stays/i })).toBeInTheDocument();

    // And Clear puts them all back.
    await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(shownStays()).toHaveLength(3);
  });

  /*
   * An unpriced, unrated `listing` result — the ordinary state for a city the
   * rate provider has never heard of. Neither filter can divide it, so neither
   * is offered rather than both being offered and doing nothing.
   */
  it('offers no filter controls for listings that carry no figures', async () => {
    renderStays([
      stay('l1', 'Guest house Umbrella', null, 0),
      stay('l2', 'Hotel Villa Tiflisi', null, 0),
    ]);

    await screen.findByText('Guest house Umbrella');

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));

    expect(screen.queryByRole('slider', { name: /price per night/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /minimum rating/i })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing to filter on here/i)).toBeInTheDocument();
  });
});
