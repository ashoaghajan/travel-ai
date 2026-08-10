/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Booking, BookingDraft } from '../../../types/booking.types';
import type { Trip } from '../../../types/trip.types';
import { AddBookingToTripDialog } from './AddBookingToTripDialog';
import { seedTrips } from '../../../test/seedTrips';
import { BookingAlreadyOnTripError, bookingService } from '../../../services/booking.service';
import { bookingStore } from '../../../store/booking.store';

// jsdom does not implement the native dialog methods.
beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  fakeBookingsApi();
  await seedTrips([makeTrip()]);

  // Reset, then load: the store caches its first fetch, and priming it here
  // keeps the first paint synchronous the way it was when it read storage.
});

function makeTrip(): Trip {
  return {
    id: 'trip_1',
    title: 'Dubai break',
    destination: 'Dubai',
    startDate: '2027-10-02',
    endDate: '2027-10-06',
    travellers: 2,
    coverImage: '/x.jpg',
    itinerary: [],
    createdAt: 'x',
    updatedAt: 'x',
  };
}

function makeDraft(overrides: Partial<BookingDraft> = {}): BookingDraft {
  return {
    tripId: 'trip_1',
    kind: 'flight',
    status: 'saved',
    title: 'Air Arabia · EVN → DXB',
    date: '2027-10-02',
    reference: '',
    price: 368,
    source: { provider: 'flights', resultId: 'f1', capturedAt: 'x' },
    ...overrides,
  };
}

function open(drafts = [makeDraft()], onAdded = vi.fn()) {
  render(
    <MemoryRouter>
      <AddBookingToTripDialog drafts={drafts} onClose={vi.fn()} onAdded={onAdded} />
    </MemoryRouter>,
  );
  return onAdded;
}

/**
 * An in-memory stand-in for the bookings API.
 *
 * The dialog writes over HTTP now. These tests are about what it records — one
 * booking or two, with which dates and which reference — so `saved` stands
 * where localStorage used to.
 */
let saved: Booking[] = [];

function fakeBookingsApi() {
  saved = [];

  // The store caches its first load, so a later case would otherwise keep
  // serving whatever an earlier one seeded.
  bookingStore.reset();

  vi.spyOn(bookingService, 'getBookings').mockImplementation(async () => saved);

  vi.spyOn(bookingService, 'create').mockImplementation(async (draft) => {
    // The rule the server enforces: the same search result cannot be filed
    // against the same trip twice.
    const clash =
      draft.source &&
      draft.tripId &&
      saved.some(
        (booking) =>
          booking.tripId === draft.tripId &&
          booking.source?.resultId === draft.source?.resultId,
      );

    if (clash) throw new BookingAlreadyOnTripError(draft.title);

    const booking = {
      ...draft,
      id: `bkg_${saved.length + 1}`,
      createdAt: 'x',
      updatedAt: 'x',
    } as Booking;

    saved = [booking, ...saved];
    return booking;
  });
}

function stored(): Booking[] {
  // Oldest first, so a round trip reads outbound then return.
  return [...saved].reverse();
}

async function seedBookings(bookings: Booking[]) {
  saved = [...bookings];
  bookingStore.reset();
  await bookingStore.refresh();
}

describe('AddBookingToTripDialog', () => {
  it('opens preselected on the trip the screen is filling for', () => {
    open();

    expect(screen.getByLabelText('Trip')).toHaveValue('trip_1');
    expect(screen.getByLabelText('Date')).toHaveValue('2027-10-02');
    expect(screen.getByText('Air Arabia · EVN → DXB')).toBeInTheDocument();
  });

  it('records the booking against that trip', async () => {
    const onAdded = open();

    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    const [booking] = stored();
    expect(booking).toMatchObject({ tripId: 'trip_1', kind: 'flight', status: 'saved' });
    expect(onAdded).toHaveBeenCalledWith('Dubai break');
  });

  it('lets a booking be kept without a trip', async () => {
    open();

    await userEvent.selectOptions(screen.getByLabelText('Trip'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    expect(stored()[0].tripId).toBeNull();
  });

  it('asks whether it is booked rather than assuming, and takes the reference', async () => {
    open();

    // Nothing is inferred from a partner redirect, so the reference field only
    // appears once the reader says they booked it.
    expect(screen.queryByLabelText('Reference')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.type(screen.getByLabelText('Reference'), 'BK-9');
    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    expect(stored()[0]).toMatchObject({ status: 'booked', reference: 'BK-9' });
  });

  it('keeps a date the reader changed', async () => {
    open();

    const date = screen.getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2027-10-04');
    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    expect(stored()[0].date).toBe('2027-10-04');
  });

  it('says so rather than duplicating when it is already on the trip', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    // A second attach of the same fare to the same trip.
    open();
    await userEvent.click(screen.getAllByRole('button', { name: 'Add to trip' })[1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('is already on this trip');
    expect(stored()).toHaveLength(1);
  });

  it('records a round trip as two bookings, one per flight', async () => {
    open([
      makeDraft(),
      makeDraft({
        title: 'Air Arabia · DXB → EVN',
        date: '2027-10-06',
        price: 184,
        source: { provider: 'flights', resultId: 'f1:return', capturedAt: 'x' },
      }),
    ]);

    expect(screen.getByText('Air Arabia · DXB → EVN')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    const saved = stored();
    expect(saved).toHaveLength(2);
    // Each keeps its own day; only the first leg's date is editable here.
    expect(saved.map((booking) => booking.date).sort()).toEqual(['2027-10-02', '2027-10-06']);
  });

  it('is not a dead end when the reader has no trips', async () => {
    await seedTrips([]);
    // Seeded after the prime in `beforeEach`, so the store has to re-read.
    open();

    expect(screen.getByText(/kept until you make one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to trip' })).toBeEnabled();
  });

  /*
   * A booking belongs to the days of its trip. The picker is bounded rather
   * than merely validated, so the days outside the trip are unclickable in the
   * calendar instead of failing after the fact.
   */
  it('bounds the date picker to the trip', () => {
    open();

    const date = screen.getByLabelText('Date');

    expect(date).toHaveAttribute('min', '2027-10-02');
    expect(date).toHaveAttribute('max', '2027-10-06');
  });

  it('says which days are allowed, rather than only greying them out', () => {
    open();

    expect(screen.getByText(/Within the trip:/)).toBeInTheDocument();
  });

  it('leaves the picker open when no trip is chosen', async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText('Trip'), '');

    const date = screen.getByLabelText('Date');

    expect(date).not.toHaveAttribute('min');
    expect(date).not.toHaveAttribute('max');
  });

  // A fare quoted for one trip, filed against another whose days it misses.
  it('pulls an out-of-range date into the trip on the way in', () => {
    open([makeDraft({ date: '2027-11-20' })]);

    expect(screen.getByLabelText('Date')).toHaveValue('2027-10-06');
  });

  it('pulls the date back in when the trip is switched', async () => {
    await seedTrips([
      makeTrip(),
      {
        ...makeTrip(),
        id: 'trip_2',
        title: 'Cairo',
        startDate: '2027-12-01',
        endDate: '2027-12-04',
      },
    ]);
    open();

    await userEvent.selectOptions(screen.getByLabelText('Trip'), 'trip_2');

    const date = screen.getByLabelText('Date');
    expect(date).toHaveAttribute('min', '2027-12-01');
    expect(date).toHaveValue('2027-12-01');
  });


  /*
   * A stay is a range, and the trip already knows which days those are —
   * retyping them is work the dialog can do for the reader.
   */
  describe('a stay', () => {
    function hotelDraft(overrides: Partial<BookingDraft> = {}): BookingDraft {
      return makeDraft({
        kind: 'hotel',
        title: 'Tezh Ler Resort',
        price: 116,
        priceBasis: { unit: 'nightly', units: 4 },
        source: { provider: 'hotels', resultId: 'h1', capturedAt: 'x' },
        ...overrides,
      });
    }

    it('asks for a check-in and a check-out', () => {
      open([hotelDraft()]);

      expect(screen.getByLabelText('Check-in')).toBeInTheDocument();
      expect(screen.getByLabelText('Check-out')).toBeInTheDocument();
    });

    it('fills both from the trip, so neither has to be retyped', () => {
      open([hotelDraft({ endDate: undefined })]);

      expect(screen.getByLabelText('Check-in')).toHaveValue('2027-10-02');
      expect(screen.getByLabelText('Check-out')).toHaveValue('2027-10-06');
    });

    it('says what the stay comes to as the dates are picked', () => {
      open([hotelDraft()]);

      // Four nights of the trip at $116.
      expect(screen.getByText(/4 nights · \$464/)).toBeInTheDocument();
    });

    it('never lets check-out fall before check-in', () => {
      open([hotelDraft()]);

      expect(screen.getByLabelText('Check-out')).toHaveAttribute('min', '2027-10-02');
    });

    it('records both dates, and counts the nights between them', async () => {
      open([hotelDraft()]);

      await userEvent.clear(screen.getByLabelText('Check-out'));
      await userEvent.type(screen.getByLabelText('Check-out'), '2027-10-05');
      await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

      const saved = stored();
      expect(saved[0].date).toBe('2027-10-02');
      expect(saved[0].endDate).toBe('2027-10-05');
      // Three nights, not the four the draft was captured with.
      expect(saved[0].priceBasis).toEqual({ unit: 'nightly', units: 3 });
    });


    /*
     * The bug this guards: bounding the picker to the *trip* let a reader pick
     * nights an existing stay already covered, so a second hotel could be
     * booked over the top of the first.
     */
    it('bounds the picker to the free nights, not the whole trip', async () => {
      await seedBookings([
        {
          id: 'existing',
          tripId: 'trip_1',
          kind: 'hotel',
          status: 'booked',
          title: 'Ramada',
          date: '2027-10-02',
          endDate: '2027-10-05',
          reference: '',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ]);
      open([hotelDraft({ date: '2027-10-05', endDate: '2027-10-06' })]);

      // The trip runs 02–06, but 02–05 is taken; only the last night is free.
      expect(screen.getByLabelText('Check-in')).toHaveAttribute('min', '2027-10-05');
      expect(screen.getByLabelText('Check-in')).toHaveAttribute('max', '2027-10-06');
      expect(screen.getByText(/Still free:/)).toBeInTheDocument();
    });

    it('keeps the whole trip open when nothing is booked', () => {
      open([hotelDraft()]);

      expect(screen.getByLabelText('Check-in')).toHaveAttribute('min', '2027-10-02');
      expect(screen.getByLabelText('Check-in')).toHaveAttribute('max', '2027-10-06');
    });

    it('asks for no check-out on a flight', () => {
      open();

      expect(screen.queryByLabelText('Check-out')).not.toBeInTheDocument();
    });
  });

});
