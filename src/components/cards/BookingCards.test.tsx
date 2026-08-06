/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Activity, Flight, Hotel } from '../../types/travel.types';
import { ActivityCard } from './ActivityCard';
import { FlightResultCard } from './FlightResultCard';
import { HotelCard } from './HotelCard';

/**
 * The one rule both priced cards share: a fare or rate is clickable only when
 * something quoted it. `bookingUrl` is null for sample data, and a card with a
 * null link must render no way to act on an invented number.
 */

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flight-1',
    airline: 'Aeroflot',
    from: 'JFK',
    to: 'DPS',
    departureTime: '11:30 PM',
    arrivalTime: '8:15 AM',
    departureDate: null,
    returnDate: null,
    duration: '28h 45m',
    stops: 1,
    price: 412,
    durationMinutes: 1725,
    bookingUrl: null,
    ...overrides,
  };
}

function hotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-1',
    name: 'Komaneka at Bisma',
    location: 'Ubud',
    category: 'Luxury Resort',
    rating: 4.8,
    reviews: 345,
    pricePerNight: 320,
    image: '/stay.jpg',
    bookingUrl: null,
    ...overrides,
  };
}

/** Times deliberately unlike the outbound's, so a match cannot be the wrong leg. */
const RETURN_LEG = {
  departureTime: '6:40 AM',
  arrivalTime: '12:15 PM',
  date: '2027-05-28',
  duration: '28h',
  durationMinutes: 1680,
  stops: 0,
};

describe('FlightResultCard', () => {
  it('shows one leg for a one-way fare, unlabelled', () => {
    render(<FlightResultCard flight={flight()} />);

    expect(screen.getByText('11:30 PM')).toBeInTheDocument();
    // Nothing to distinguish it from, so no "Outbound" heading and no badge.
    expect(screen.queryByText('Outbound')).not.toBeInTheDocument();
    expect(screen.queryByText(/Round trip/)).not.toBeInTheDocument();
  });

  it('shows both flights when the price buys both', () => {
    render(
      <FlightResultCard
        flight={flight({ returnDate: '2027-05-28', returnLeg: RETURN_LEG })}
      />,
    );

    expect(screen.getByText('Outbound')).toBeInTheDocument();
    expect(screen.getByText('Return')).toBeInTheDocument();
    expect(screen.getByText('6:40 AM')).toBeInTheDocument();
    expect(screen.getByText('12:15 PM')).toBeInTheDocument();
    expect(screen.getByText(/Round trip/)).toBeInTheDocument();
  });

  it('reverses the route on the way back', () => {
    render(<FlightResultCard flight={flight({ returnLeg: RETURN_LEG })} />);

    // JFK → DPS out, DPS → JFK home. Two of each code, one per leg.
    expect(screen.getAllByText(/JFK/)).toHaveLength(2);
    expect(screen.getAllByText(/DPS/)).toHaveLength(2);
  });

  it('keeps each leg’s own duration', () => {
    render(<FlightResultCard flight={flight({ returnLeg: RETURN_LEG })} />);

    expect(screen.getByText('28h 45m')).toBeInTheDocument();
    expect(screen.getByText('28h')).toBeInTheDocument();
  });

  it('offers no booking link for a sample fare', () => {
    render(<FlightResultCard flight={flight()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // The price is still shown; it is only the call to action that is absent.
    expect(screen.getByText('$412')).toBeInTheDocument();
  });

  it('books a quoted fare', () => {
    render(<FlightResultCard flight={flight({ bookingUrl: 'https://partner.test/fare?marker=1' })} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://partner.test/fare?marker=1');
  });

  it('opens the partner away from the app', () => {
    render(<FlightResultCard flight={flight({ bookingUrl: 'https://partner.test/fare' })} />);

    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
  });

  // `sponsored` is what a paid affiliate link is supposed to declare.
  it('declares the link as sponsored', () => {
    render(<FlightResultCard flight={flight({ bookingUrl: 'https://partner.test/fare' })} />);

    expect(screen.getByRole('link').getAttribute('rel')).toContain('sponsored');
  });

  // "Book" twelve times over tells a screen-reader user nothing about which.
  it('names what is being booked, and for how much', () => {
    render(<FlightResultCard flight={flight({ bookingUrl: 'https://partner.test/fare' })} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(/Aeroflot/);
    expect(link).toHaveAccessibleName(/\$412/);
    expect(link).toHaveAccessibleName(/JFK/);
  });
});

describe('ActivityCard', () => {
  const activity: Activity = {
    id: 'a1',
    title: 'Cascade Complex',
    category: 'culture',
    description: 'A giant stairway of gardens.',
    price: 0,
    rating: 0,
    reviews: 0,
    image: '/cascade.jpg',
  };

  it('renders as it always did when no actions are supplied', () => {
    render(
      <MemoryRouter>
        <ActivityCard activity={activity} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Cascade Complex' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Book/ })).not.toBeInTheDocument();
  });

  it('offers both actions on the booking screen', async () => {
    const onAddToTrip = vi.fn();
    render(
      <MemoryRouter>
        <ActivityCard
          activity={activity}
          onAddToTrip={onAddToTrip}
          bookingUrl="https://partner.test/tours?q=Cascade"
        />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));
    expect(onAddToTrip).toHaveBeenCalledTimes(1);

    const book = screen.getByRole('link', { name: /Book Cascade Complex/ });
    expect(book).toHaveAttribute('href', 'https://partner.test/tours?q=Cascade');
    expect(book).toHaveAttribute('rel', 'sponsored noopener');
  });

  it('says when an attraction is already on the trip', () => {
    render(
      <MemoryRouter>
        <ActivityCard activity={activity} onAddToTrip={vi.fn()} isOnTrip />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'On this trip' })).toBeDisabled();
  });

  it('shows no price when the source has none, rather than showing zero', () => {
    render(
      <MemoryRouter>
        <ActivityCard activity={activity} />
      </MemoryRouter>,
    );

    // OpenTripMap has no pricing at all — `activity.service` hardcodes zero.
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    // No partner to point at in the explorer, so no stand-in either.
    expect(screen.queryByText('Price on partner site')).not.toBeInTheDocument();
  });

  it('says where the price lives when there is a partner to point at', () => {
    render(
      <MemoryRouter>
        <ActivityCard activity={activity} bookingUrl="https://partner.test/tours" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Price on partner site')).toBeInTheDocument();
  });

  it('shows a real price when the source does carry one', () => {
    render(
      <MemoryRouter>
        <ActivityCard
          activity={{ ...activity, price: 45 }}
          bookingUrl="https://partner.test/tours"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('$45')).toBeInTheDocument();
    expect(screen.queryByText('Price on partner site')).not.toBeInTheDocument();
  });
});

describe('HotelCard', () => {
  it('offers no booking link for a sample rate', () => {
    render(<HotelCard hotel={hotel()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('$320')).toBeInTheDocument();
  });

  it('books a quoted stay', () => {
    render(<HotelCard hotel={hotel({ bookingUrl: 'https://partner.test/stay' })} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://partner.test/stay');
  });

  /*
   * A button rather than the whole card. Wrapping an anchor around the photo,
   * the name, the rating and the price would give a screen reader one link
   * whose name is all of that read out at once.
   */
  it('does not swallow the whole card into one link', () => {
    render(<HotelCard hotel={hotel({ bookingUrl: 'https://partner.test/stay' })} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(/Komaneka at Bisma/);
    expect(link).not.toHaveAccessibleName(/345/);
  });
});
