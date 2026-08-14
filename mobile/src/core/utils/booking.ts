import type { Booking, BookingKind, PriceBasis } from '../types/booking.types';
import type { ItineraryDay } from '../types/trip.types';
import type { MoneyFormatter } from './currency';
import { addDays, formatShortDate, fromIsoDate, nightsBetween, toIsoDate } from './date';

/** Human label for each kind, singular. */
const KIND_LABELS: Record<BookingKind, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  ticket: 'Ticket',
  activity: 'Activity',
};

export function bookingKindLabel(kind: BookingKind): string {
  return KIND_LABELS[kind];
}

export type BookingGroup = {
  /** ISO calendar date, or `''` for the undated group. */
  date: string;
  label: string;
  bookings: Booking[];
};

/** What the undated group is called. */
const UNDATED_LABEL = 'No date yet';

/**
 * Bookings by the day they happen, earliest first, undated last.
 *
 * Grouping by date rather than by kind because that is the order a trip is
 * lived in: the flight out, the hotel that night, the tour two days later.
 * Each leg of a round trip is its own booking, so the flight home lands in
 * the group for the day it actually departs.
 *
 * The undated group sits at the end rather than the start — an entry nobody
 * has dated yet is the least settled thing on the list, not the first thing
 * that happens.
 */
export function groupBookingsByDate(bookings: Booking[]): BookingGroup[] {
  const byDate = new Map<string, Booking[]>();

  for (const booking of bookings) {
    const existing = byDate.get(booking.date);
    if (existing) existing.push(booking);
    else byDate.set(booking.date, [booking]);
  }

  const dated = [...byDate.entries()]
    .filter(([date]) => date !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({ date, label: formatShortDate(date), bookings: group }));

  const undated = byDate.get('');

  return undated ? [...dated, { date: '', label: UNDATED_LABEL, bookings: undated }] : dated;
}

/** What a trip supplies for pricing the bookings filed against it. */
export type TripPricing = { nights: number; travellers: number };

/**
 * Which provider prices in which unit.
 *
 * Only consulted for a booking saved before `priceBasis` existed. A row with
 * no `source` at all is a hand-typed one — the legacy migration emits those
 * (`booking.migration.ts`) — and a hand-typed number is a total.
 */
const INFERRED_UNIT: Record<string, PriceBasis['unit']> = {
  hotels: 'nightly',
  flights: 'perPerson',
  opentripmap: 'perPerson',
};

/**
 * What `booking.price` is measured in.
 *
 * The stored basis always wins: it records what the reader was actually
 * quoted, and nothing later — a trip's dates being edited, a different party
 * size — may restate it.
 *
 * Absent, the unit is inferred from which producer answered. This exists for
 * the bookings already sitting in readers' browsers, which predate the field:
 * without it, every stay saved before this change would keep reporting one
 * night of a multi-night trip, and the bug would look unfixed to exactly the
 * people who noticed it. The *unit* is a fact about the provider and safe to
 * infer; only the count is a guess, and it is taken from the trip the booking
 * is filed against, falling back to 1 when there is no trip in hand.
 */
export function bookingPriceBasis(booking: Booking, trip?: TripPricing): PriceBasis {
  if (booking.priceBasis) return booking.priceBasis;

  // A stay that records its own check-out needs nothing guessed: its nights
  // are on the record, and they beat the trip's, which may be longer.
  if (booking.kind === 'hotel' && booking.endDate) {
    return stayPriceBasis(booking.date, booking.endDate);
  }

  const unit = INFERRED_UNIT[booking.source?.provider ?? ''];
  if (!unit) return { unit: 'perPerson', units: 1 };

  return {
    unit,
    units: Math.max(1, (unit === 'nightly' ? trip?.nights : trip?.travellers) ?? 1),
  };
}

/**
 * What a booking is doing on a particular day.
 *
 * A stay appears twice — the day you arrive and the day you leave — and the
 * two mean different things to someone reading a schedule. Everything else
 * happens once, on its own day.
 */
export type BookingMoment = 'checkIn' | 'checkOut' | 'on';

export type DayBooking = { booking: Booking; moment: BookingMoment };

/**
 * Which kinds anchor a day, in the order they are lived.
 *
 * A schedule reads as a sequence: you land, you drop your bags, you go and do
 * something. Sorting by kind rather than by the order rows were saved is what
 * makes a day read that way instead of as a list in creation order.
 */
const DAY_ORDER: Record<BookingMoment | BookingKind, number> = {
  flight: 0,
  checkOut: 1,
  checkIn: 2,
  hotel: 2,
  ticket: 3,
  activity: 4,
  on: 5,
};

/**
 * Everything booked for one day of a trip.
 *
 * The schedule needs this because a booking is not an itinerary activity: the
 * itinerary is what somebody planned, and these are the flights, rooms and
 * tickets they actually hold. Showing only the plan left a day that had a
 * flight and a hotel on it looking empty.
 */
export function bookingsOnDay(bookings: Booking[], date: string): DayBooking[] {
  if (!date) return [];

  const found: DayBooking[] = [];

  for (const booking of bookings) {
    if (booking.kind === 'hotel') {
      // Both ends land on the schedule; a stay's middle nights do not, or a
      // week in one hotel would repeat itself seven times.
      if (booking.date === date) found.push({ booking, moment: 'checkIn' });
      if (booking.endDate === date) found.push({ booking, moment: 'checkOut' });
      continue;
    }

    if (booking.date === date) found.push({ booking, moment: 'on' });
  }

  return found.sort(
    (a, b) =>
      (DAY_ORDER[a.moment === 'on' ? a.booking.kind : a.moment] ?? 9) -
      (DAY_ORDER[b.moment === 'on' ? b.booking.kind : b.moment] ?? 9),
  );
}

/**
 * The same day's bookings, minus the ones its own schedule already shows.
 *
 * A planned trip files a booking for every stop, so without this every day of
 * it reads twice over: "Activity · Shared snorkel trip" as a chip, and then
 * "08:30 Shared snorkel trip" as the row underneath. The chip exists to show
 * the fixed points a day is built around — a flight, a room — not to restate
 * the plan sitting directly below it.
 *
 * Keyed on the result id rather than on `source.provider`, so a stop the reader
 * later deletes from the schedule gets its chip back. The booking is then the
 * only record that it was ever happening, and hiding it would lose it.
 */
export function bookingsAlongsideDay(bookings: Booking[], day: ItineraryDay): DayBooking[] {
  const planned = new Set<string>();

  for (const activity of day.activities) {
    // Both ids, because a stop is filed under whichever it has — see
    // `itineraryActivityToBookingDraft`.
    planned.add(activity.id);
    if (activity.sourceActivityId) planned.add(activity.sourceActivityId);
  }

  return bookingsOnDay(bookings, day.date).filter(({ booking }) => {
    const resultId = booking.source?.resultId;
    // A row typed by hand carries no source and is nobody's duplicate.
    return resultId === undefined || !planned.has(resultId);
  });
}

/** The ISO date after this one. Nights are walked one at a time. */
function nextDay(iso: string): string {
  return toIsoDate(addDays(fromIsoDate(iso), 1));
}

/** A run of trip nights with nowhere booked to sleep. */
export type StayGap = {
  /** Check-in for the gap. */
  from: string;
  /** Check-out — the morning after the last uncovered night. */
  to: string;
  nights: number;
};

/**
 * Which nights of a trip still have no bed booked.
 *
 * A trip is a run of nights, not days: Sep 3 to Sep 7 is four nights, the last
 * of which is Sep 6. A stay from Sep 3 to Sep 6 covers three of them and
 * leaves Sep 6 open — which is exactly the gap a reader wants filled and could
 * not see before, because the list offered every hotel as though nothing were
 * booked.
 *
 * Only a **booked** stay covers a night. A shortlisted one is a candidate, and
 * treating it as coverage would stop anyone saving two hotels for the same
 * dates to compare them — which is most of what a shortlist is for.
 */
export function stayGaps(startDate: string, endDate: string, bookings: Booking[]): StayGap[] {
  if (!startDate || !endDate || startDate >= endDate) return [];

  const covered = new Set<string>();

  for (const booking of bookings) {
    if (booking.kind !== 'hotel' || booking.status !== 'booked' || !booking.date) continue;

    // No check-out recorded covers the check-in night alone: one night is what
    // the record actually evidences.
    const until =
      booking.endDate && booking.endDate > booking.date ? booking.endDate : nextDay(booking.date);

    for (let night = booking.date; night < until; night = nextDay(night)) {
      covered.add(night);
    }
  }

  const gaps: StayGap[] = [];
  let open: string | null = null;

  for (let night = startDate; night < endDate; night = nextDay(night)) {
    if (covered.has(night)) {
      if (open) {
        gaps.push({ from: open, to: night, nights: nightsBetween(open, night) });
        open = null;
      }
      continue;
    }

    open ??= night;
  }

  if (open) gaps.push({ from: open, to: endDate, nights: nightsBetween(open, endDate) });

  return gaps;
}

/**
 * The basis a stay's own check-in and check-out imply.
 *
 * A stay is the one kind whose multiplier is visible on its own record, so it
 * is derived from those two dates rather than from the trip: shortening a
 * booking from five nights to three should cost three nights, whatever the
 * trip around it says. Every other kind keeps the basis it was captured with.
 *
 * One night when there is no check-out to measure against — the rate is real
 * and belongs on screen, and guessing a longer stay would inflate the total.
 */
export function stayPriceBasis(checkIn: string, checkOut?: string): PriceBasis {
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 1;

  return { unit: 'nightly', units: Math.max(1, nights) };
}

/**
 * The same basis, counted against a different trip.
 *
 * A draft is priced for whichever trip the search was set up for, and the
 * reader may then file it against another one. Four nights of a rate landing
 * on a ten-night trip has to become ten, or the stay is under-counted from the
 * moment it is saved. A `total` basis is unaffected — it has no count to
 * rebase — and so is a draft filed against no trip at all.
 */
export function rebasePriceBasis(
  basis: PriceBasis | undefined,
  trip: TripPricing | null,
): PriceBasis | undefined {
  if (!basis || !trip) return basis;

  return {
    unit: basis.unit,
    units: Math.max(1, basis.unit === 'nightly' ? trip.nights : trip.travellers),
  };
}

/**
 * What one booking actually costs, as opposed to what it is quoted at.
 *
 * The distinction is the whole point. A hotel's stored price is one night, a
 * fare's is one passenger; only `priceBasis` says which, and only multiplying
 * by it gives a number that can be added to another kind of booking. Without
 * this, four nights at $116 and two $182 fares came to $479 rather than $828.
 *
 * Undefined when no price was recorded — which is not zero. Nobody has said
 * what this costs, and calling it free would make the total quietly too low.
 */
export function bookingAmount(booking: Booking, trip?: TripPricing): number | undefined {
  if (booking.price === undefined) return undefined;

  const basis = bookingPriceBasis(booking, trip);

  return booking.price * Math.max(1, basis.units);
}

/**
 * How a line total was arrived at: "$116 × 4 nights", "$181.50 × 2 travellers".
 *
 * Null when the stored price *is* the line total, which is most rows — there
 * is no working to show, and a caption reading "× 1" would be noise.
 *
 * This exists because a card showing only the unit price cannot be added up by
 * eye: four nights at $116 next to a trip total of $1,190 looks like an error
 * in the total rather than a rate that has to be multiplied.
 */
export function describeBookingAmount(
  booking: Booking,
  money: MoneyFormatter,
  trip?: TripPricing,
): string | null {
  if (booking.price === undefined) return null;

  const basis = bookingPriceBasis(booking, trip);
  if (basis.units <= 1) return null;

  const noun = basis.unit === 'nightly' ? 'night' : 'traveller';

  return `${money.formatExact(booking.price)} × ${basis.units} ${noun}${basis.units === 1 ? '' : 's'}`;
}

/** What a set of bookings comes to, and what that figure is made of. */
export type BookingTotals = {
  total: number;
  /** How many carried a price, so the caller can say what the total covers. */
  priced: number;
  counted: number;
  /**
   * Whether any priced row came from invented data.
   *
   * A total mixing sample prices has to say so, on the same reasoning as
   * `PriceNote`: an invented number the reader could act on is worse than no
   * number at all.
   */
  hasSample: boolean;
};

export function bookingTotals(bookings: Booking[], trip?: TripPricing): BookingTotals {
  let total = 0;
  let priced = 0;
  let hasSample = false;

  for (const booking of bookings) {
    const amount = bookingAmount(booking, trip);
    if (amount === undefined) continue;

    total += amount;
    priced += 1;
    if (booking.source?.priceSource === 'sample') hasSample = true;
  }

  return { total, priced, counted: bookings.length, hasSample };
}
