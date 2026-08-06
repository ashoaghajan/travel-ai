/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Booking } from '../../../types/booking.types';
import type { Trip } from '../../../types/trip.types';
import { STORAGE_KEYS, storageService } from '../../../services/localStorage.service';
import { TripBookings } from './TripBookings';

const TRIP_ID = 'trip_1';

const TRIP: Trip = {
  id: TRIP_ID,
  title: 'One week in Yerevan',
  destination: 'Yerevan',
  destinationCity: 'Yerevan',
  startDate: '2027-05-20',
  endDate: '2027-05-26',
  travellers: 2,
  coverImage: '/x.jpg',
  itinerary: [],
  createdAt: 'x',
  updatedAt: 'x',
};

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bkg-1',
    tripId: TRIP_ID,
    kind: 'hotel',
    status: 'booked',
    title: 'Hotel Indigo',
    date: '2027-05-20',
    reference: 'BK-4471',
    price: 420,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed(bookings: Booking[]) {
  storageService.set(STORAGE_KEYS.bookings, bookings);
}

function renderTab() {
  return render(
    <MemoryRouter>
      <TripBookings trip={TRIP} />
    </MemoryRouter>,
  );
}

describe('TripBookings', () => {
  beforeEach(() => {
    storageService.remove(STORAGE_KEYS.bookings);

    // jsdom does not implement the native dialog methods the picker uses.
    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
      this.open = false;
    });
  });

  it('offers the way to find something when nothing is booked', () => {
    renderTab();

    expect(screen.getByText('Nothing booked yet')).toBeInTheDocument();
    // The outbound half of the two-way link.
    expect(screen.getByRole('link', { name: /booking screen/ })).toHaveAttribute(
      'href',
      `/bookings?tripId=${TRIP_ID}`,
    );
  });

  it('asks for a reference only once there is one to give', async () => {
    // A shortlisted row has no confirmation number by definition, and a
    // planned trip now files ten of them at once.
    seed([makeBooking({ status: 'saved', reference: '' })]);
    renderTab();

    expect(screen.queryByLabelText(/^Reference for/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mark as booked' }));

    expect(await screen.findByLabelText(/^Reference for/)).toBeInTheDocument();
  });

  it('keeps a reference visible on a row that already carries one', () => {
    // Shortlisted again after being booked — the number must not vanish.
    seed([makeBooking({ status: 'saved', reference: 'BK-4471' })]);
    renderTab();

    expect(screen.getByLabelText(/^Reference for/)).toHaveValue('BK-4471');
  });

  it('says how much of the total is guessed, as the header does', () => {
    seed([
      makeBooking({ id: 'real', price: 400 }),
      makeBooking({
        id: 'guess',
        kind: 'activity',
        title: 'Snorkel trip',
        price: 40,
        source: {
          provider: 'itinerary',
          resultId: 'act_1',
          priceSource: 'sample',
          capturedAt: 'x',
        },
      }),
    ]);
    renderTab();

    // The bare "$440" this used to show read as the firmer of the two claims
    // while being the looser one.
    expect(screen.getByText(/1 is an estimate/)).toBeInTheDocument();
  });

  it('claims nothing about estimates when every price is a real one', () => {
    seed([makeBooking({ price: 400 })]);
    renderTab();

    expect(screen.queryByText(/estimate/)).not.toBeInTheDocument();
  });

  it('browses the catalogue inline, with no dialog to open first', () => {
    renderTab();

    // The same tabs `/bookings` shows, on the page rather than behind a modal.
    expect(screen.getByRole('heading', { name: 'Add to this trip' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hotels' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Activities' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows only the bookings for this trip', () => {
    seed([makeBooking(), makeBooking({ id: 'bkg-2', tripId: 'other', title: 'Not mine' })]);
    renderTab();

    expect(screen.getByDisplayValue('Hotel Indigo')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Not mine')).not.toBeInTheDocument();
  });

  it('ignores a booking attached to no trip', () => {
    seed([makeBooking({ tripId: null })]);
    renderTab();

    expect(screen.getByText('Nothing booked yet')).toBeInTheDocument();
  });

  it('groups by date and puts the undated group last', () => {
    seed([
      makeBooking({ id: 'a', date: '', title: 'Undated' }),
      makeBooking({ id: 'b', date: '2027-05-22', title: 'Later' }),
      makeBooking({ id: 'c', date: '2027-05-20', title: 'Earlier' }),
    ]);
    renderTab();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/20/);
    expect(headings[1]).toMatch(/22/);
    expect(headings[2]).toBe('No date yet');
  });

  it('lists each leg of a round trip as its own deletable booking', async () => {
    seed([
      makeBooking({
        id: 'out',
        kind: 'flight',
        title: 'Air Arabia · AUH → EVN',
        date: '2026-09-02',
        price: 181.5,
      }),
      makeBooking({
        id: 'back',
        kind: 'flight',
        title: 'Air Arabia · EVN → AUH',
        date: '2026-09-09',
        price: 181.5,
      }),
    ]);
    renderTab();

    // Two date groups; the browser below has a heading of its own.
    expect(screen.getAllByRole('heading', { name: /Sep|May|No date/ })).toHaveLength(2);
    expect(screen.getByText(/^2 bookings/)).toBeInTheDocument();
    // $181.50 each — the halves the fare was split into still sum to $363.
    expect(screen.getByText('$363')).toBeInTheDocument();
    // Each leg carries its own price, its own reference and its own delete.
    expect(screen.getAllByLabelText(/^Reference for/)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: /Remove Air Arabia · EVN → AUH/ }));

    const left = storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe('out');
  });

  it('draws a card from what the search captured', () => {
    seed([
      makeBooking({
        source: {
          provider: 'hotels',
          resultId: 'h1',
          subtitle: 'Luxury Resort · Ubud',
          image: 'https://example.com/hotel.jpg',
          bookingUrl: 'https://example.com/book',
          capturedAt: '2027-01-01T00:00:00.000Z',
        },
      }),
    ]);
    renderTab();

    expect(screen.getByText('Luxury Resort · Ubud')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View booking/ });
    expect(link).toHaveAttribute('href', 'https://example.com/book');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says when a price was invented rather than quoted', () => {
    seed([
      makeBooking({
        source: {
          provider: 'flights',
          resultId: 'f1',
          priceSource: 'sample',
          capturedAt: '2027-01-01T00:00:00.000Z',
        },
      }),
    ]);
    renderTab();

    expect(screen.getByText('sample price')).toBeInTheDocument();
  });

  it('totals only what carries a price, and says what is missing', () => {
    seed([
      makeBooking({ id: 'a', price: 420 }),
      makeBooking({ id: 'b', price: 100, date: '2027-05-21' }),
      makeBooking({ id: 'c', price: undefined, date: '2027-05-22' }),
    ]);
    renderTab();

    expect(screen.getByText(/1 has no price yet/)).toBeInTheDocument();
    // Neither row carries a basis, so both are taken as totals rather than
    // multiplied by the six nights — 520, not 3,120.
    expect(screen.getByText('$520')).toBeInTheDocument();
  });

  /*
   * The regression the price basis exists to prevent. A nightly rate saved
   * from the Hotels tab covers every night of the stay — six here — and a flat
   * sum would report one night of it.
   */
  it('counts a nightly rate for the whole stay', () => {
    seed([
      makeBooking({
        id: 'a',
        price: 116,
        priceBasis: { unit: 'nightly', units: 6 },
      }),
    ]);
    renderTab();

    // Once on the row, once in the trip total — the column adds up by eye.
    expect(screen.getAllByText('$696')).toHaveLength(2);
    // And never the nightly rate on its own, which is what confused the total.
    expect(screen.queryByText('$116')).not.toBeInTheDocument();
  });

  /*
   * The row shows what the booking costs; the working shows how that was
   * reached. Without it a reader sees $696 against a hotel they were quoted
   * $116 for and cannot tell where the number came from.
   */
  it('shows the working under a multiplied price', () => {
    seed([
      makeBooking({ id: 'a', price: 116, priceBasis: { unit: 'nightly', units: 6 } }),
      makeBooking({
        id: 'b',
        kind: 'flight',
        date: '2027-05-21',
        price: 181.5,
        priceBasis: { unit: 'perPerson', units: 2 },
      }),
    ]);
    renderTab();

    expect(screen.getByText('$116 × 6 nights')).toBeInTheDocument();
    // Cents kept, so $181.50 × 2 visibly makes the $363 shown above it.
    expect(screen.getByText('$181.50 × 2 travellers')).toBeInTheDocument();
    expect(screen.getByText('$363')).toBeInTheDocument();
  });

  it('shows no working when the price is already the line total', () => {
    seed([makeBooking({ id: 'a', price: 420 })]);
    renderTab();

    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('says so when nothing carries a price', () => {
    seed([makeBooking({ id: 'a', price: undefined })]);
    renderTab();

    expect(screen.getByText(/no prices recorded yet/)).toBeInTheDocument();
  });

  it('saves an edit immediately, with no Save Changes step', async () => {
    seed([makeBooking()]);
    renderTab();

    await userEvent.type(screen.getByLabelText(/Title for/), '!');

    const stored = storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);
    expect(stored[0].title).toBe('Hotel Indigo!');
  });

  it('moves a booking between booked and shortlisted', async () => {
    seed([makeBooking()]);
    renderTab();

    await userEvent.click(screen.getByRole('button', { name: 'Move to shortlist' }));

    expect(storageService.get<Booking[]>(STORAGE_KEYS.bookings, [])[0].status).toBe('saved');
    expect(await screen.findByText('Shortlisted')).toBeInTheDocument();
  });

  it('removes a booking', async () => {
    seed([makeBooking()]);
    renderTab();

    await userEvent.click(screen.getByRole('button', { name: /Remove Hotel Indigo/ }));

    expect(storageService.get<Booking[]>(STORAGE_KEYS.bookings, [])).toEqual([]);
  });

  it('names an untitled booking by its kind, so Remove is unambiguous', () => {
    seed([makeBooking({ title: '' })]);
    renderTab();

    expect(screen.getByRole('button', { name: 'Remove this hotel' })).toBeInTheDocument();
  });

  it('keeps a blank row available for something booked elsewhere', async () => {
    seed([makeBooking()]);
    renderTab();

    // One button, with the kinds revealed behind it rather than three across.
    await userEvent.click(screen.getByRole('button', { name: 'Add by hand' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ticket' }));

    const stored = storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);
    expect(stored.some((booking) => booking.kind === 'ticket' && booking.title === '')).toBe(true);
  });

  it('keeps the kinds hidden until asked for', () => {
    seed([makeBooking()]);
    renderTab();

    expect(screen.queryByRole('button', { name: 'Ticket' })).not.toBeInTheDocument();
  });

  it('survives a corrupt row rather than taking the tab down', () => {
    storageService.set(STORAGE_KEYS.bookings, [makeBooking(), { id: 'junk' }]);
    renderTab();

    const list = screen.getAllByRole('listitem');
    expect(list).toHaveLength(1);
    expect(within(list[0]).getByDisplayValue('Hotel Indigo')).toBeInTheDocument();
  });

  // The same rule as the add dialog. Constraining only the way in would leave
  // the date one click away from being moved back outside the trip.
  it('bounds each row\'s date editor to the trip', () => {
    seed([makeBooking()]);
    renderTab();

    const date = screen.getByLabelText(/Check-in for/);

    expect(date).toHaveAttribute('min', '2027-05-20');
    expect(date).toHaveAttribute('max', '2027-05-26');
  });

  /*
   * A stay occupies a range. Its nights are what the nightly rate is
   * multiplied by, so they belong on the record rather than being taken from
   * whatever the trip happens to be.
   */
  it('gives a stay a check-out as well as a check-in', () => {
    seed([makeBooking({ endDate: '2027-05-24' })]);
    renderTab();

    const checkOut = screen.getByLabelText(/Check-out for/);

    expect(checkOut).toHaveValue('2027-05-24');
    // Never before the check-in, whatever the trip allows.
    expect(checkOut).toHaveAttribute('min', '2027-05-20');
  });

  it('asks for no check-out on a flight', () => {
    seed([makeBooking({ kind: 'flight', title: 'AUH → EVN' })]);
    renderTab();

    expect(screen.queryByLabelText(/Check-out for/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Date for/)).toBeInTheDocument();
  });

  it('reprices a stay when its check-out moves', async () => {
    seed([
      makeBooking({
        price: 100,
        date: '2027-05-20',
        endDate: '2027-05-26',
        priceBasis: { unit: 'nightly', units: 6 },
      }),
    ]);
    renderTab();

    // Six nights at $100 to start with.
    expect(screen.getAllByText('$600').length).toBeGreaterThan(0);

    await userEvent.clear(screen.getByLabelText(/Check-out for/));
    await userEvent.type(screen.getByLabelText(/Check-out for/), '2027-05-23');

    const stored = storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);
    expect(stored[0].endDate).toBe('2027-05-23');
    // Three nights now, and the price follows rather than staying at six.
    expect(stored[0].priceBasis).toEqual({ unit: 'nightly', units: 3 });
  });

});
