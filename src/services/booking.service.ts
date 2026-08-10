import type {
  Booking,
  BookingDraft,
  BookingPatch,
  BookingKind,
  BookingStatus,
  PriceBasis,
} from '../types/booking.types';
import type {
  Activity,
  BookingContext,
  Flight,
  Hotel,
  Partner,
  PartnerCategory,
  PriceSource,
} from '../types/travel.types';
import type { ItineraryActivity, ItineraryDay, Trip } from '../types/trip.types';
import { CATEGORY_IMAGES } from '../assets/category-images';
import { createId } from '../utils/id';
import { usdFormatter } from '../utils/currency';
import { nightsBetween } from '../utils/date';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Flights, stays, tickets and activities the reader has attached to a trip.
 *
 * Its own collection rather than a field on `Trip`, because a booking can be
 * found before the trip it belongs to has been chosen — `tripId` is nullable
 * and stays that way until the reader files it. See `booking.types.ts`.
 *
 * Async like the other domain services, so Stage 2 can move it behind
 * `GET /api/bookings` without changing a caller.
 */

/**
 * Bounded, but not the way `savedActivity` is.
 *
 * A newest-first cap would throw away a real reservation to make room for
 * something merely shortlisted, so eviction drops `saved` rows first and only
 * touches `booked` ones when there is nothing else left to drop.
 */
const MAX_BOOKINGS = 500;

export class BookingNotFoundError extends Error {
  constructor(id: string) {
    super(`No booking with id "${id}".`);
    this.name = 'BookingNotFoundError';
  }
}

/** Mirrors `ActivityAlreadyOnDayError` — refuse rather than duplicate. */
export class BookingAlreadyOnTripError extends Error {
  constructor(title: string) {
    super(`"${title}" is already on this trip.`);
    this.name = 'BookingAlreadyOnTripError';
  }
}

const KINDS: BookingKind[] = ['flight', 'hotel', 'ticket', 'activity'];
const STATUSES: BookingStatus[] = ['saved', 'booked'];

function isBooking(value: unknown): value is Booking {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Booking>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.date === 'string' &&
    typeof candidate.reference === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.tripId === null || typeof candidate.tripId === 'string') &&
    KINDS.includes(candidate.kind as BookingKind) &&
    STATUSES.includes(candidate.status as BookingStatus)
  );
}

function read(): Booking[] {
  const stored = storageService.get<unknown>(STORAGE_KEYS.bookings, []);
  if (!Array.isArray(stored)) return [];

  // A hand-edited or half-written entry drops out rather than crashing the tab.
  return stored.filter(isBooking);
}

/** Drops shortlisted rows before confirmed ones when over the cap. */
function evict(bookings: Booking[]): Booking[] {
  if (bookings.length <= MAX_BOOKINGS) return bookings;

  const booked = bookings.filter((booking) => booking.status === 'booked');
  const saved = bookings.filter((booking) => booking.status === 'saved');

  // Confirmed reservations first, then as many shortlisted ones as still fit.
  return [...booked, ...saved].slice(0, MAX_BOOKINGS);
}

function write(bookings: Booking[]): void {
  storageService.set(STORAGE_KEYS.bookings, evict(bookings));
}

function touch(booking: Booking, patch: BookingPatch): Booking {
  return { ...booking, ...patch, updatedAt: new Date().toISOString() };
}

export const bookingService = {
  /** Newest first. */
  async getBookings(): Promise<Booking[]> {
    return read();
  },

  /**
   * Records a booking.
   *
   * Refuses a second attach of the same search result to the same trip, the
   * way `addActivityToDay` refuses a repeated attraction. The same fare on two
   * different trips is legitimate, so the check is scoped to `tripId` — and a
   * row with no `source` was typed by hand and is never a duplicate of
   * anything.
   */
  async create(draft: BookingDraft): Promise<Booking> {
    const bookings = read();

    if (draft.source && draft.tripId) {
      const clash = bookings.find(
        (booking) =>
          booking.tripId === draft.tripId &&
          booking.source?.resultId === draft.source?.resultId,
      );
      if (clash) throw new BookingAlreadyOnTripError(draft.title);
    }

    const now = new Date().toISOString();
    const booking: Booking = { ...draft, id: createId('bkg'), createdAt: now, updatedAt: now };

    write([booking, ...bookings]);
    return booking;
  },

  async update(id: string, patch: BookingPatch): Promise<Booking> {
    const bookings = read();
    const index = bookings.findIndex((booking) => booking.id === id);
    if (index === -1) throw new BookingNotFoundError(id);

    /*
     * A price the reader typed is what the line cost, not a rate.
     *
     * Without this, correcting a hotel row to the $800 actually paid would
     * quietly become $800 a night. Only a patch that sets `price` without
     * saying what it measures clears the basis; one that sets both is taken at
     * its word.
     */
    const settled: BookingPatch =
      patch.price !== undefined && patch.priceBasis === undefined
        ? { ...patch, priceBasis: undefined }
        : patch;

    const updated = touch(bookings[index], settled);

    write(bookings.map((booking, i) => (i === index ? updated : booking)));
    return updated;
  },

  /**
   * Files every stop on a planned trip as a booking, in one write.
   *
   * Called once, when a trip the planner wrote is saved. The alternative —
   * showing the schedule on the Bookings tab and asking which stops to keep —
   * put a second list of the same eleven things under the first and made the
   * reader do the sorting. Filing them all is the blunter answer and the
   * clearer one: everything the trip involves is in one place, and removing
   * the two that are not reservations is a click each.
   *
   * Every row lands `saved`, never `booked`. Nothing has been reserved — the
   * planner cannot reserve anything — and the prices come through flagged
   * `sample`, so the trip's headline still reads "estimated". See
   * `itineraryActivityToBookingDraft`.
   *
   * Idempotent, because `createTrip` is: saving the same draft twice returns
   * the same trip, and this must not then double its bookings. A stop already
   * filed under its result id is skipped, which also covers the reader who
   * booked something from the catalogue before the trip was saved.
   */
  async createFromItinerary(trip: Trip): Promise<Booking[]> {
    const bookings = read();
    const filed = new Set(
      bookings
        .filter((booking) => booking.tripId === trip.id)
        .map((booking) => booking.source?.resultId)
        .filter((resultId): resultId is string => resultId !== undefined),
    );

    const now = new Date().toISOString();
    const created: Booking[] = [];

    for (const day of trip.itinerary) {
      for (const activity of day.activities) {
        const draft = itineraryActivityToBookingDraft(activity, day, trip.id, trip.travellers);
        const resultId = draft.source?.resultId;

        // Also guards within the batch: the same attraction can sit on two
        // days, and both would carry one `sourceActivityId`.
        if (resultId !== undefined) {
          if (filed.has(resultId)) continue;
          filed.add(resultId);
        }

        created.push({ ...draft, id: createId('bkg'), createdAt: now, updatedAt: now });
      }
    }

    if (created.length === 0) return [];

    // Schedule order, not reversed. The store is newest-first and
    // `groupBookingsByDate` keeps a group in array order, so writing the batch
    // as it runs is what makes day one's morning read before its afternoon —
    // creating them one at a time would stack each day backwards.
    write([...created, ...bookings]);
    return created;
  },

  async remove(id: string): Promise<void> {
    write(read().filter((booking) => booking.id !== id));
  },

  /** Files a booking against a trip, or against none when `tripId` is null. */
  async attach(id: string, tripId: string | null): Promise<Booking> {
    return bookingService.update(id, { tripId });
  },

  async setStatus(id: string, status: BookingStatus): Promise<Booking> {
    return bookingService.update(id, { status });
  },
};

/**
 * Synchronous read, used only by the store so subscribers paint the stored
 * state on the first render — the same split `trip.service` uses.
 */
export function readBookingsSync(): Booking[] {
  return read();
}

/** True when this trip already carries a booking made from this result. */
export function isResultOnTrip(
  bookings: Booking[],
  tripId: string | null,
  resultId: string,
): boolean {
  if (!tripId) return false;
  return bookings.some(
    (booking) => booking.tripId === tripId && booking.source?.resultId === resultId,
  );
}

/* -------------------------------------------------------------------------
 * Mappers — a search result to a booking the reader could file.
 *
 * Here rather than in the feature module for the same reason
 * `toItineraryActivity` lives in `trip.service.ts`: they are the shape of the
 * data, and they belong with the store that persists it.
 * ---------------------------------------------------------------------- */

/** `null` on the wire, absent in a `BookingSource`. */
function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * How many of the party a per-person price covers.
 *
 * Floored at one so a context with no travellers recorded prices for a single
 * reader rather than multiplying the fare to nothing.
 */
function perPerson(context: BookingContext): PriceBasis {
  return { unit: 'perPerson', units: Math.max(1, context.travellers) };
}

/**
 * How many nights a nightly rate covers.
 *
 * From the context's own dates, which come from the trip when there is one —
 * see `resolveBookingContext`. A stay with no return date recorded is one
 * night: the rate is real and the reader should see it, and guessing a longer
 * stay would inflate the total on no evidence.
 */
function perNight(context: BookingContext): PriceBasis {
  const nights =
    context.departDate && context.returnDate
      ? nightsBetween(context.departDate, context.returnDate)
      : 1;

  return { unit: 'nightly', units: Math.max(1, nights) };
}

function capture(
  provider: string,
  resultId: string,
  extras: {
    subtitle?: string;
    image?: string;
    bookingUrl?: string | null;
    price?: number | null;
    priceSource?: PriceSource;
    route?: { from: string; to: string };
    coordinates?: { lat: number; lng: number };
  },
) {
  return {
    provider,
    resultId,
    subtitle: extras.subtitle,
    image: extras.image,
    bookingUrl: optional(extras.bookingUrl),
    price: optional(extras.price),
    priceSource: extras.priceSource,
    route: extras.route,
    coordinates: extras.coordinates,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * A fare.
 *
 * The date comes from `flight.departureDate` before the searched date: live
 * fares are found in a month-wide cache and routinely depart a day or two off
 * what was asked for, which is the whole reason that field exists. Filing one
 * under the day it does not leave is exactly the confusion it was added to
 * prevent.
 */
/**
 * A fare, as one booking per flight it buys.
 *
 * A round trip is two tickets on two days, and they are kept as two records so
 * each can be dated, referenced and deleted on its own.
 *
 * **The split price is ours, not the provider's.** A round-trip fare is quoted
 * as one number and never broken down by leg, so each record carries half —
 * which keeps the trip's total exactly right and is the only division that
 * does not favour one leg over the other. The subtitle says so, because a
 * reader who saw $181.50 and no explanation would think that is what a seat
 * cost. The halves are computed so they always sum back to the original, even
 * on an odd number of cents.
 */
export function flightToBookingDrafts(
  flight: Flight,
  context: BookingContext,
  tripId: string | null,
  priceSource?: PriceSource,
): BookingDraft[] {
  const { returnLeg } = flight;
  const outDate = flight.departureDate ?? context.departDate ?? '';
  const returnDate = returnLeg ? (returnLeg.date ?? context.returnDate ?? '') : '';

  // A return leg with nowhere to sit is not a booking anyone can act on; the
  // fare stays a single record covering the outbound.
  const isRoundTrip = Boolean(returnLeg && returnDate);

  const outPrice = isRoundTrip ? Math.round((flight.price / 2) * 100) / 100 : flight.price;
  const backPrice = Math.round((flight.price - outPrice) * 100) / 100;
  /*
   * Dollars, deliberately, and not the reader's display currency.
   *
   * This string is written into the saved booking rather than rendered from
   * it, so whatever it says is frozen at the moment of saving. Baking in a
   * converted figure would leave a booking permanently quoting a currency the
   * reader has since switched away from, at a rate that has since moved. What
   * it records is what the provider quoted, which was dollars.
   */
  const half = isRoundTrip ? ` · half of a ${usdFormatter.formatExact(flight.price)} round trip` : '';

  const outbound: BookingDraft = {
    tripId,
    kind: 'flight',
    status: 'saved',
    title: `${flight.airline} · ${flight.from} → ${flight.to}`,
    date: outDate,
    reference: '',
    price: outPrice,
    // A fare is quoted per passenger. The return leg below inherits this
    // through the spread, which is right: both halves are per-person.
    priceBasis: perPerson(context),
    source: capture('flights', flight.id, {
      subtitle: `${flight.departureTime} – ${flight.arrivalTime} · ${flight.duration}${half}`,
      bookingUrl: flight.bookingUrl,
      price: outPrice,
      priceSource,
      route: { from: flight.from, to: flight.to },
    }),
  };

  if (!isRoundTrip || !returnLeg) return [outbound];

  return [
    outbound,
    {
      ...outbound,
      title: `${flight.airline} · ${flight.to} → ${flight.from}`,
      date: returnDate,
      price: backPrice,
      source: capture(
        'flights',
        // Its own result id, or the duplicate check would refuse the second
        // leg as a re-add of the first.
        `${flight.id}:return`,
        {
          subtitle: returnLeg.duration
            ? `${returnLeg.departureTime} – ${returnLeg.arrivalTime} · ${returnLeg.duration}${half}`
            : `${returnLeg.departureTime}${half}`,
          bookingUrl: flight.bookingUrl,
          price: backPrice,
          priceSource,
          // Reversed: the way home runs the other way round.
          route: { from: flight.to, to: flight.from },
        },
      ),
    },
  ];
}

export function hotelToBookingDraft(
  hotel: Hotel,
  context: BookingContext,
  tripId: string | null,
  priceSource?: PriceSource,
): BookingDraft {
  return {
    tripId,
    kind: 'hotel',
    status: 'saved',
    title: hotel.name,
    // Check-in and check-out, which for a stay filed against a trip are the
    // days the reader is there — the context takes both from the trip.
    date: context.departDate ?? '',
    endDate: context.returnDate ?? undefined,
    reference: '',
    price: optional(hotel.pricePerNight),
    // A nightly rate, so the total has to know how many nights it buys.
    priceBasis: hotel.pricePerNight === null ? undefined : perNight(context),
    source: capture('hotels', hotel.id, {
      subtitle: `${hotel.category} · ${hotel.location}`,
      image: hotel.image,
      bookingUrl: hotel.bookingUrl,
      price: hotel.pricePerNight,
      priceSource,
      // Kept for the same reason an attraction's is: the trip map can then pin
      // the building rather than geocode its name and hope.
      coordinates: hotel.coordinates,
    }),
  };
}

export function activityToBookingDraft(
  activity: Activity,
  context: BookingContext,
  tripId: string | null,
): BookingDraft {
  return {
    tripId,
    kind: 'activity',
    status: 'saved',
    title: activity.title,
    date: context.departDate ?? '',
    reference: '',
    // Zero means "no price known" on an `Activity`, and absent means the same
    // thing here — storing 0 would render as free.
    price: activity.price > 0 ? activity.price : undefined,
    // Admission is per head. No price means no basis — there is nothing to
    // multiply, and a basis without a price would only mislead a later reader.
    priceBasis: activity.price > 0 ? perPerson(context) : undefined,
    source: capture('opentripmap', activity.id, {
      subtitle: activity.category,
      image: activity.image,
      bookingUrl: activity.sourceUrl,
      price: activity.price > 0 ? activity.price : null,
      // OpenTripMap knows exactly where this is; keeping it saves the trip
      // map a lookup it would otherwise have to make by name.
      coordinates: activity.coordinates,
    }),
  };
}

/**
 * A stop the planner put on a day, as something the reader could go and book.
 *
 * The one mapper whose input is a plan rather than a search result, and the
 * only one with no provider behind it: there is no partner, no product id and
 * no quote, just a line the model wrote. The row still has to look like every
 * other booking, because a list where some entries are photographs and others
 * are bare text reads as a list that half failed to load.
 *
 * So the two things it can honestly supply, it supplies:
 *
 * A picture, from `CATEGORY_IMAGES` when the stop carries none of its own.
 * That is what those images are for — the explorer already dresses OpenTripMap
 * results with them, since most places come back with no photograph.
 *
 * A price, from `priceEstimate`, flagged `sample`. The estimate is per head,
 * so it gets a `perPerson` basis and multiplies out like a fare does. Marking
 * it `sample` is not a footnote: `bookingTotals` reports `hasSample`, and
 * `formatTripTotal` reads that to keep the trip's headline saying "estimated"
 * rather than claiming the reader has spent a number the model invented. The
 * row says "sample price" under the figure for the same reason.
 *
 * `sourceActivityId` is preferred as the result id so a stop imported from the
 * explorer is recognised whichever way it was booked — that is the id
 * `activityToBookingDraft` files the same attraction under.
 */
export function itineraryActivityToBookingDraft(
  activity: ItineraryActivity,
  day: ItineraryDay,
  tripId: string | null,
  /** The party the per-head estimate is multiplied by. Floored at one. */
  travellers: number,
): BookingDraft {
  // Zero means "the planner said this is free", which is a real claim and not
  // the same as no price — but a `0` price would render as "$0" beside rows
  // that cost something, so it is dropped like `activityToBookingDraft` drops
  // an activity priced at zero.
  const estimate = activity.priceEstimate && activity.priceEstimate > 0
    ? activity.priceEstimate
    : undefined;

  return {
    tripId,
    kind: 'activity',
    status: 'saved',
    title: activity.title,
    date: day.date,
    reference: '',
    price: estimate,
    priceBasis:
      estimate === undefined ? undefined : { unit: 'perPerson', units: Math.max(1, travellers) },
    source: capture('itinerary', activity.sourceActivityId ?? activity.id, {
      // The stop's own description, falling back to where the day is spent —
      // a blank second line reads as a row that failed to load.
      subtitle: activity.description || day.destination || undefined,
      image: activity.image || CATEGORY_IMAGES[activity.category],
      price: estimate,
      // Never omitted when there is a price. This is the flag that stops a
      // guess being presented as a fare.
      priceSource: estimate === undefined ? undefined : 'sample',
      // Only an imported stop has these; carrying them saves the trip map a
      // lookup, for the same reason `activityToBookingDraft` copies them.
      coordinates: activity.coordinates,
    }),
  };
}

/** Which kind a partner tab records as, when the reader books through one. */
const PARTNER_KINDS: Record<PartnerCategory, BookingKind> = {
  flights: 'flight',
  hotels: 'hotel',
  activities: 'activity',
};

export function partnerToBookingDraft(
  partner: Partner,
  category: PartnerCategory,
  url: string,
  context: BookingContext,
  tripId: string | null,
): BookingDraft {
  return {
    tripId,
    kind: PARTNER_KINDS[category],
    status: 'saved',
    title: partner.name,
    date: context.departDate ?? '',
    reference: '',
    source: capture(partner.id, `${partner.id}:${category}`, {
      subtitle: partner.description,
      bookingUrl: url,
    }),
  };
}
