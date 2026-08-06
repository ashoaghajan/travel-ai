import { describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { ItineraryDay } from '../types/trip.types';
import {
  bookingAmount,
  bookingKindLabel,
  bookingPriceBasis,
  bookingTotals,
  bookingsAlongsideDay,
  bookingsOnDay,
  describeBookingAmount,
  groupBookingsByDate,
  rebasePriceBasis,
  stayGaps,
  stayPriceBasis,
} from './booking';

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    tripId: 'trip_1',
    kind: 'hotel',
    status: 'booked',
    title: 'Hotel Indigo',
    date: '2027-05-20',
    reference: '',
    price: 100,
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

describe('bookingKindLabel', () => {
  it('names every kind', () => {
    expect(bookingKindLabel('flight')).toBe('Flight');
    expect(bookingKindLabel('hotel')).toBe('Hotel');
    expect(bookingKindLabel('ticket')).toBe('Ticket');
    expect(bookingKindLabel('activity')).toBe('Activity');
  });
});

describe('groupBookingsByDate', () => {
  it('is empty for nothing', () => {
    expect(groupBookingsByDate([])).toEqual([]);
  });

  it('orders the dated groups earliest first', () => {
    const groups = groupBookingsByDate([
      makeBooking({ id: 'a', date: '2027-05-22' }),
      makeBooking({ id: 'b', date: '2027-05-20' }),
      makeBooking({ id: 'c', date: '2027-05-21' }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(['2027-05-20', '2027-05-21', '2027-05-22']);
  });

  it('puts several on one day into the same group, in the order given', () => {
    const groups = groupBookingsByDate([
      makeBooking({ id: 'a', title: 'First' }),
      makeBooking({ id: 'b', title: 'Second' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].bookings.map((booking) => booking.title)).toEqual(['First', 'Second']);
  });

  it('puts each leg of a round trip in its own day’s group', () => {
    // Two records, because a round trip is two tickets — see
    // `flightToBookingDrafts`.
    const groups = groupBookingsByDate([
      makeBooking({ id: 'out', date: '2027-05-20', title: 'JFK → DPS' }),
      makeBooking({ id: 'hotel', date: '2027-05-24' }),
      makeBooking({ id: 'back', date: '2027-05-28', title: 'DPS → JFK' }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(['2027-05-20', '2027-05-24', '2027-05-28']);
    expect(groups[2].bookings[0].title).toBe('DPS → JFK');
  });

  it('puts the undated group last, however the input was ordered', () => {
    const groups = groupBookingsByDate([
      makeBooking({ id: 'a', date: '' }),
      makeBooking({ id: 'b', date: '2027-05-20' }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(['2027-05-20', '']);
    expect(groups[1].label).toBe('No date yet');
  });

  it('handles a list that is entirely undated', () => {
    const groups = groupBookingsByDate([makeBooking({ date: '' })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('No date yet');
  });

  it('labels a dated group with the short date', () => {
    expect(groupBookingsByDate([makeBooking()])[0].label).toMatch(/20/);
  });
});

/** The Yerevan trip from the bug report: 4 nights, 1 traveller. */
const YEREVAN = { nights: 4, travellers: 1 };

/** A stay quoted per night, as the Hotels tab saves one. */
function hotelRow(price: number, overrides: Partial<Booking> = {}) {
  return makeBooking({
    kind: 'hotel',
    price,
    priceBasis: { unit: 'nightly', units: 4 },
    ...overrides,
  });
}

describe('bookingPriceBasis', () => {
  it('takes the stored basis at its word', () => {
    const stored = { unit: 'nightly', units: 9 } as const;

    expect(bookingPriceBasis(makeBooking({ priceBasis: stored }), YEREVAN)).toEqual(stored);
  });

  /*
   * Below: bookings saved before the field existed. The unit is a fact about
   * which producer answered and is safe to read off `source.provider`; only
   * the count is a guess, and it comes from the trip.
   */
  it('infers a nightly rate for a stay from the hotels provider', () => {
    const booking = makeBooking({ source: { provider: 'hotels', resultId: 'h', capturedAt: 'x' } });

    expect(bookingPriceBasis(booking, YEREVAN)).toEqual({ unit: 'nightly', units: 4 });
  });

  it('infers a per-person fare from the flights provider', () => {
    const booking = makeBooking({ source: { provider: 'flights', resultId: 'f', capturedAt: 'x' } });

    expect(bookingPriceBasis(booking, { nights: 4, travellers: 3 })).toEqual({
      unit: 'perPerson',
      units: 3,
    });
  });

  // A hand-typed row, and what the legacy migration produces: no source at all.
  it('treats a row with no provider as already a total', () => {
    expect(bookingPriceBasis(makeBooking(), YEREVAN)).toEqual({ unit: 'perPerson', units: 1 });
  });

  it('falls back to one when there is no trip to count against', () => {
    const booking = makeBooking({ source: { provider: 'hotels', resultId: 'h', capturedAt: 'x' } });

    expect(bookingPriceBasis(booking).units).toBe(1);
  });
});

describe('bookingAmount', () => {
  it('multiplies a nightly rate by the nights it buys', () => {
    expect(bookingAmount(hotelRow(116))).toBe(464);
  });

  it('multiplies a fare by the party it seats', () => {
    const fare = makeBooking({ price: 182, priceBasis: { unit: 'perPerson', units: 2 } });

    expect(bookingAmount(fare)).toBe(364);
  });

  it('leaves a hand-typed price alone', () => {
    expect(bookingAmount(makeBooking({ price: 420 }), { nights: 6, travellers: 2 })).toBe(420);
  });

  it('is absent, not zero, when nobody recorded a price', () => {
    expect(bookingAmount(makeBooking({ price: undefined }))).toBeUndefined();
  });
});

describe('bookingTotals', () => {
  it('is zero for nothing', () => {
    expect(bookingTotals([]).total).toBe(0);
  });

  /*
   * The regression this whole change exists to prevent. Four nights at $116
   * and two halves of a $363 fare summed flat to $479; the stay alone is $464.
   */
  it('prices the Yerevan trip at what it actually costs', () => {
    const bookings = [
      hotelRow(116),
      makeBooking({ kind: 'flight', price: 182, priceBasis: { unit: 'perPerson', units: 1 } }),
      makeBooking({ kind: 'flight', price: 181, priceBasis: { unit: 'perPerson', units: 1 } }),
    ];

    expect(bookingTotals(bookings).total).toBe(827);
  });

  it('scales the same trip to a second traveller', () => {
    const bookings = [
      hotelRow(116),
      makeBooking({ kind: 'flight', price: 182, priceBasis: { unit: 'perPerson', units: 2 } }),
      makeBooking({ kind: 'flight', price: 181, priceBasis: { unit: 'perPerson', units: 2 } }),
    ];

    // The room is the same room; only the seats double.
    expect(bookingTotals(bookings).total).toBe(464 + 726);
  });

  it('says how much of the set it covers', () => {
    const bookings = [hotelRow(116), makeBooking({ price: undefined })];
    const { total, priced, counted } = bookingTotals(bookings);

    expect({ total, priced, counted }).toEqual({ total: 464, priced: 1, counted: 2 });
  });

  it('counts a zero price as recorded', () => {
    expect(bookingTotals([makeBooking({ price: 0 })]).priced).toBe(1);
  });

  it('flags a total built on an invented price', () => {
    const sample = makeBooking({
      source: { provider: 'flights', resultId: 'f', capturedAt: 'x', priceSource: 'sample' },
    });

    expect(bookingTotals([sample]).hasSample).toBe(true);
    expect(bookingTotals([makeBooking()]).hasSample).toBe(false);
  });
});


describe('describeBookingAmount', () => {
  it('shows how a nightly rate became a stay', () => {
    expect(describeBookingAmount(hotelRow(116))).toBe('$116 × 4 nights');
  });

  // Cents kept on purpose: $182 × 2 would read as $364, not the $363 quoted.
  it('keeps the cents on a half fare', () => {
    const leg = makeBooking({ price: 181.5, priceBasis: { unit: 'perPerson', units: 2 } });

    expect(describeBookingAmount(leg)).toBe('$181.50 × 2 travellers');
  });

  it('says nothing when the price is already the line total', () => {
    expect(describeBookingAmount(makeBooking({ price: 420 }))).toBeNull();
  });

  it('says nothing for a single unit, rather than "× 1"', () => {
    const single = makeBooking({ price: 90, priceBasis: { unit: 'nightly', units: 1 } });

    expect(describeBookingAmount(single)).toBeNull();
  });

  it('says nothing when there is no price at all', () => {
    expect(describeBookingAmount(makeBooking({ price: undefined }))).toBeNull();
  });
});


describe('stayPriceBasis', () => {
  it('counts the nights between check-in and check-out', () => {
    expect(stayPriceBasis('2027-05-20', '2027-05-26')).toEqual({ unit: 'nightly', units: 6 });
  });

  // The rate is real and belongs on screen; guessing a longer stay would
  // inflate the total on no evidence.
  it('falls back to one night with no check-out', () => {
    expect(stayPriceBasis('2027-05-20')).toEqual({ unit: 'nightly', units: 1 });
  });

  it('never counts zero nights', () => {
    expect(stayPriceBasis('2027-05-20', '2027-05-20').units).toBe(1);
  });
});



describe('stayGaps', () => {
  /** A booked stay, which is the only kind that covers a night. */
  function stay(from: string, to: string, overrides: Partial<Booking> = {}) {
    return makeBooking({ kind: 'hotel', status: 'booked', date: from, endDate: to, ...overrides });
  }

  // Sep 3 to Sep 7 is four nights: the 3rd, 4th, 5th and 6th.
  it('reports the whole trip when nothing is booked', () => {
    expect(stayGaps('2026-09-03', '2026-09-07', [])).toEqual([
      { from: '2026-09-03', to: '2026-09-07', nights: 4 },
    ]);
  });

  it('reports nothing when a stay covers every night', () => {
    expect(stayGaps('2026-09-03', '2026-09-07', [stay('2026-09-03', '2026-09-07')])).toEqual([]);
  });

  /*
   * The case from the screenshot: a Sep 3-7 trip with a stay booked to the
   * 6th leaves the night of the 6th with nowhere to sleep.
   */
  it('finds the last night when a stay ends early', () => {
    expect(stayGaps('2026-09-03', '2026-09-07', [stay('2026-09-03', '2026-09-06')])).toEqual([
      { from: '2026-09-06', to: '2026-09-07', nights: 1 },
    ]);
  });

  it('finds a gap at the start', () => {
    expect(stayGaps('2026-09-03', '2026-09-07', [stay('2026-09-05', '2026-09-07')])).toEqual([
      { from: '2026-09-03', to: '2026-09-05', nights: 2 },
    ]);
  });

  it('finds a gap in the middle, between two stays', () => {
    const gaps = stayGaps('2026-09-03', '2026-09-08', [
      stay('2026-09-03', '2026-09-04'),
      stay('2026-09-06', '2026-09-08', { id: 'b2' }),
    ]);

    expect(gaps).toEqual([{ from: '2026-09-04', to: '2026-09-06', nights: 2 }]);
  });

  it('finds several gaps at once', () => {
    const gaps = stayGaps('2026-09-03', '2026-09-09', [stay('2026-09-04', '2026-09-05')]);

    expect(gaps).toEqual([
      { from: '2026-09-03', to: '2026-09-04', nights: 1 },
      { from: '2026-09-05', to: '2026-09-09', nights: 4 },
    ]);
  });

  it('lets overlapping stays cover between them', () => {
    const gaps = stayGaps('2026-09-03', '2026-09-07', [
      stay('2026-09-03', '2026-09-05'),
      stay('2026-09-04', '2026-09-07', { id: 'b2' }),
    ]);

    expect(gaps).toEqual([]);
  });

  /*
   * A shortlisted hotel is a candidate, not a bed. Counting it would stop
   * anyone saving two options for the same nights to compare them.
   */
  it('ignores a shortlisted stay', () => {
    const gaps = stayGaps('2026-09-03', '2026-09-07', [
      stay('2026-09-03', '2026-09-07', { status: 'saved' }),
    ]);

    expect(gaps).toEqual([{ from: '2026-09-03', to: '2026-09-07', nights: 4 }]);
  });

  it('ignores a flight booked across the same days', () => {
    const gaps = stayGaps('2026-09-03', '2026-09-07', [
      makeBooking({ kind: 'flight', status: 'booked', date: '2026-09-03' }),
    ]);

    expect(gaps).toHaveLength(1);
  });

  // A stay saved before check-out existed evidences one night, not a stay of
  // unknown length.
  it('counts a stay with no check-out as one night', () => {
    const gaps = stayGaps('2026-09-03', '2026-09-06', [
      makeBooking({ kind: 'hotel', status: 'booked', date: '2026-09-03', endDate: undefined }),
    ]);

    expect(gaps).toEqual([{ from: '2026-09-04', to: '2026-09-06', nights: 2 }]);
  });

  it('has no nights to report for a one-day trip', () => {
    expect(stayGaps('2026-09-03', '2026-09-03', [])).toEqual([]);
  });
});



describe('bookingsOnDay', () => {
  const stay = makeBooking({
    id: 'h', kind: 'hotel', title: 'Ramada',
    date: '2026-09-03', endDate: '2026-09-06',
  });
  const outbound = makeBooking({ id: 'f1', kind: 'flight', title: 'AUH → EVN', date: '2026-09-03' });
  const tour = makeBooking({ id: 'a1', kind: 'activity', title: 'Dalma', date: '2026-09-04' });

  it('shows a stay on the day it starts and the day it ends', () => {
    expect(bookingsOnDay([stay], '2026-09-03').map((e) => e.moment)).toEqual(['checkIn']);
    expect(bookingsOnDay([stay], '2026-09-06').map((e) => e.moment)).toEqual(['checkOut']);
  });

  // Otherwise a week in one hotel would repeat itself on all seven days.
  it('leaves the nights between a stay alone', () => {
    expect(bookingsOnDay([stay], '2026-09-04')).toEqual([]);
  });

  it('puts everything else on its own day', () => {
    expect(bookingsOnDay([tour], '2026-09-04').map((e) => e.booking.id)).toEqual(['a1']);
    expect(bookingsOnDay([tour], '2026-09-05')).toEqual([]);
  });

  /*
   * A day reads as a sequence: you land, you drop your bags, you go out. The
   * order is by kind rather than by when the rows happened to be saved.
   */
  it('orders a day the way it is lived', () => {
    const day = bookingsOnDay([tour, stay, outbound], '2026-09-03');

    expect(day.map((e) => e.booking.id)).toEqual(['f1', 'h']);
  });

  it('puts a check-out before the next check-in on a moving day', () => {
    const next = makeBooking({
      id: 'h2', kind: 'hotel', title: 'Ibis', date: '2026-09-06', endDate: '2026-09-07',
    });

    expect(bookingsOnDay([next, stay], '2026-09-06').map((e) => e.moment)).toEqual([
      'checkOut',
      'checkIn',
    ]);
  });

  it('has nothing to show for a day with no date', () => {
    expect(bookingsOnDay([stay], '')).toEqual([]);
  });
});

describe('bookingsAlongsideDay', () => {
  function makeDay(overrides: Partial<ItineraryDay> = {}): ItineraryDay {
    return {
      id: 'day_1',
      dayNumber: 1,
      date: '2026-09-04',
      destination: 'Yerevan',
      summary: 'Old town',
      activities: [],
      ...overrides,
    };
  }

  const planned = makeDay({
    activities: [
      { id: 'act_1', time: '09:00', title: 'Dalma', description: '', category: 'culture' },
    ],
  });

  const fromPlan = makeBooking({
    id: 'a1',
    kind: 'activity',
    title: 'Dalma',
    date: '2026-09-04',
    source: { provider: 'itinerary', resultId: 'act_1', capturedAt: 'x' },
  });

  it('drops a booking the day already lists as an activity', () => {
    // Otherwise a planned trip prints each of its stops twice — once as a
    // chip, once as the row directly beneath it.
    expect(bookingsAlongsideDay([fromPlan], planned)).toEqual([]);
  });

  it('keeps the fixed points a day is built around', () => {
    const room = makeBooking({ id: 'h', kind: 'hotel', title: 'Ibis', date: '2026-09-04' });

    expect(bookingsAlongsideDay([room, fromPlan], planned).map((e) => e.booking.id)).toEqual(['h']);
  });

  it('gives a stop its chip back once it leaves the schedule', () => {
    // The booking is then the only record that it was ever happening.
    expect(bookingsAlongsideDay([fromPlan], makeDay()).map((e) => e.booking.id)).toEqual(['a1']);
  });

  it('matches an imported stop on the id the catalogue filed it under', () => {
    const imported = makeDay({
      activities: [
        {
          id: 'act_9',
          time: '10:00',
          title: 'Blue Mosque',
          description: '',
          category: 'culture',
          sourceActivityId: 'otm_1',
        },
      ],
    });
    const booked = makeBooking({
      id: 'a2',
      kind: 'activity',
      date: '2026-09-04',
      source: { provider: 'opentripmap', resultId: 'otm_1', capturedAt: 'x' },
    });

    expect(bookingsAlongsideDay([booked], imported)).toEqual([]);
  });

  it('never hides a row typed by hand, which duplicates nothing', () => {
    const byHand = makeBooking({ id: 'm1', kind: 'activity', title: 'Dalma', date: '2026-09-04' });

    expect(bookingsAlongsideDay([byHand], planned).map((e) => e.booking.id)).toEqual(['m1']);
  });
});


describe('rebasePriceBasis', () => {
  // A draft priced for one trip, filed against another.
  it('recounts nights against the trip actually chosen', () => {
    const basis = { unit: 'nightly', units: 4 } as const;

    expect(rebasePriceBasis(basis, { nights: 10, travellers: 2 })).toEqual({
      unit: 'nightly',
      units: 10,
    });
  });

  it('recounts a fare against the new party', () => {
    const basis = { unit: 'perPerson', units: 1 } as const;

    expect(rebasePriceBasis(basis, { nights: 10, travellers: 3 })?.units).toBe(3);
  });

  it('leaves a draft filed against no trip as it was', () => {
    const basis = { unit: 'nightly', units: 4 } as const;

    expect(rebasePriceBasis(basis, null)).toEqual(basis);
  });
});
