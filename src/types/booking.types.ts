import type { PriceSource } from './travel.types';

/**
 * Bookings — one user-scoped collection, not four tables and not a field on
 * `Trip`.
 *
 * A booking outlives the search that produced it, and can exist before the
 * traveller has decided which trip it belongs to. That is why it is its own
 * record with a nullable `tripId` rather than an entry inside a trip.
 *
 * It is also why it copies what it needs to draw itself: the flight and hotel
 * searches are keyed to one query and expire, so an id alone would leave a
 * saved fare unrenderable the moment the reader searched somewhere else — the
 * same reasoning `savedActivity.service.ts` gives for storing whole cards.
 */

/** What the booking covers. `flight` is new; the other three are the old set. */
export type BookingKind = 'flight' | 'hotel' | 'ticket' | 'activity';

/**
 * How far along it is.
 *
 * `saved` is a shortlist entry — attached to a trip but not paid for. `booked`
 * is a real reservation, which is what a reference number belongs to. Nothing
 * infers `booked` from an affiliate redirect: the partner never tells us
 * whether the checkout completed, so only the reader can say.
 */
export type BookingStatus = 'saved' | 'booked';

/**
 * Where the row came from, copied at the moment it was attached.
 *
 * This is what lets the trip's Bookings tab render a card with a photograph
 * and a working partner link instead of a line of typed text, and what lets a
 * second attach of the same result be recognised as a duplicate.
 *
 * Absent on a booking typed in by hand — that is the only difference between
 * the two, so every consumer must treat it as optional.
 */
export type BookingSource = {
  /** Which producer answered: `flights`, `hotels`, `opentripmap`, or a `Partner.id`. */
  provider: string;
  /** The producer's own id — `Flight.id`, `Hotel.id`, `Activity.id`. */
  resultId: string;
  /** Second line on the card: "EVN → DXB · Air Arabia", "Luxury Resort · Ubud". */
  subtitle?: string;
  image?: string;
  /** Back to the exact fare or rate. `null` on the wire becomes absent here. */
  bookingUrl?: string;
  /** USD, as quoted when it was attached — not necessarily what was paid. */
  price?: number;
  /**
   * Whether that quote was real.
   *
   * A `sample` price is invented, and a card showing one must say so rather
   * than passing it off as a fare.
   */
  priceSource?: PriceSource;
  /**
   * The airports a flight runs between, as IATA codes.
   *
   * Stored rather than parsed back out of the title, which is editable — a
   * reader who renames a row to "Flight home" would otherwise take its pins
   * off the map. Only ever set on a flight.
   */
  route?: { from: string; to: string };
  /**
   * Where the place is, when the producer knew.
   *
   * Copied so the trip map can draw a pin without a lookup. Attractions carry
   * one from OpenTripMap; a hotel listing does not, and is geocoded from its
   * name instead — see `useBookingCoordinates`.
   */
  coordinates?: { lat: number; lng: number };
  /** ISO instant the row was copied. */
  capturedAt: string;
};

/**
 * The multiplier a stored price needs before it can join a total.
 *
 * Captured when the quote was captured, not derived from the trip at render
 * time. A quote is a fact about a moment: recomputing it later would restate a
 * price the reader was shown whenever they edited the trip's dates or party
 * size, and it could not price a booking attached to no trip at all — which
 * this app deliberately supports.
 */
export type PriceBasis = {
  unit: 'nightly' | 'perPerson';
  /** Nights for `nightly`, travellers for `perPerson`. At least 1. */
  units: number;
};

export type Booking = {
  id: string;
  /**
   * The trip this belongs to, or null for one attached to nothing yet.
   *
   * Nullable on purpose: you can find a fare before deciding which trip it is
   * for, and demanding a trip at that moment is what would push people back
   * out to the partner with nothing recorded.
   *
   * A `tripId` naming a trip that has since been deleted reads as unassigned.
   * Nothing rewrites it — see `booking.store.ts`.
   */
  tripId: string | null;
  kind: BookingKind;
  status: BookingStatus;
  title: string;
  /**
   * ISO calendar date, `YYYY-MM-DD`. Empty when unknown.
   *
   * The tab groups by this, and an empty one lands in its own group rather
   * than being guessed at from the trip's start date.
   */
  date: string;
  /**
   * Check-out, for a stay. `date` is the check-in.
   *
   * Only a hotel has one: a flight and an activity happen on a day, but a
   * stay occupies a range, and the number of nights in that range is what its
   * nightly rate is multiplied by. Absent on every other kind, and on a stay
   * saved before the field existed.
   */
  endDate?: string;
  /** Confirmation number, as the provider issued it. Empty until booked. */
  reference: string;
  /** What it cost, once known. Absent is not zero. */
  price?: number;
  /**
   * What `price` measures, so a total can add it to other prices correctly.
   *
   * The field exists because `price` is three different units depending on
   * what was saved: a hotel's is per night, a flight's and an activity's are
   * per person. Summing them raw — which is what the bookings tab did before
   * this — adds a nightly rate to a pair of fares and reports a number that is
   * too low by however many nights the reader is staying.
   *
   * Absent means the price is already a total. That is true of a hand-typed
   * one, of a partner link that carries no quote, and of every booking saved
   * before this field existed. Absent is therefore the safe default: it makes
   * the old rows sum exactly as they always did rather than multiplying them
   * by a nights count nobody ever recorded.
   */
  priceBasis?: PriceBasis;
  /** The confirmation page, if the reader has one. */
  url?: string;
  source?: BookingSource;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp; equal to `createdAt` until it is edited. */
  updatedAt: string;
};

/** A booking the store has not given an id or timestamps to yet. */
export type BookingDraft = Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>;

/** What is editable. `id`, `createdAt` and `source` are not. */
export type BookingPatch = Partial<Omit<Booking, 'id' | 'createdAt' | 'source'>>;
