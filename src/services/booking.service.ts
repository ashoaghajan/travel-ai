import { ERROR_CODES } from '@ai-travel/shared';
import type {
  Booking,
  BookingDraft,
  BookingKind,
  BookingPatch,
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
import { usdFormatter } from '../utils/currency';
import { nightsBetween } from '../utils/date';
import { ApiError, http } from './http';

/**
 * Flights, stays, tickets and activities the reader has attached to a trip.
 *
 * Its own collection rather than a field on `Trip`, because a booking can be
 * found before the trip it belongs to has been chosen — `tripId` is nullable
 * and stays that way until the reader files it. See `booking.types.ts`.
 *
 * Persisted through `/api/bookings`. Everything else in this file — turning a
 * fare into drafts, working out what a nightly rate comes to, building the
 * partner links — stays here, because none of it is the server's business.
 *
 * The old 500-row cap is gone with the storage it protected. It existed
 * because these shared a 5MB quota with the reader's trips, and dropping a
 * shortlisted row to make space was the least bad answer; against a database
 * there is nothing to make space for.
 */

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

/**
 * Turns an API failure back into the error the callers branch on.
 *
 * Same shape as `trip.service`'s: every booking failure the server can report
 * has a code, and anything unrecognised is rethrown untouched so a network
 * blip is never dressed up as "that booking is gone".
 */
function rethrowBookingError(error: unknown, context: { id?: string; title?: string }): never {
  if (error instanceof ApiError) {
    if (error.code === ERROR_CODES.BOOKING_NOT_FOUND) {
      throw new BookingNotFoundError(context.id ?? '');
    }
    if (error.code === ERROR_CODES.BOOKING_ALREADY_ON_TRIP) {
      throw new BookingAlreadyOnTripError(context.title ?? 'That booking');
    }
  }

  throw error;
}

/** A draft, minus the fields the server assigns. */
function toBody(draft: BookingDraft) {
  return {
    tripId: draft.tripId,
    kind: draft.kind,
    status: draft.status,
    title: draft.title,
    date: draft.date,
    endDate: draft.endDate,
    reference: draft.reference,
    price: draft.price,
    priceBasis: draft.priceBasis,
    url: draft.url,
    source: draft.source,
  };
}

export const bookingService = {
  /** Newest first. */
  async getBookings(): Promise<Booking[]> {
    return http.get<Booking[]>('/bookings');
  },

  /**
   * Records a booking.
   *
   * Refuses a second attach of the same search result to the same trip, the
   * way `addActivityToDay` refuses a repeated attraction. That check runs
   * server-side now, which is what makes it hold across two tabs — the old
   * one compared against a list this browser happened to be holding.
   */
  async create(draft: BookingDraft): Promise<Booking> {
    try {
      return await http.post<Booking>('/bookings', toBody(draft));
    } catch (error) {
      return rethrowBookingError(error, { title: draft.title });
    }
  },

  async update(id: string, patch: BookingPatch): Promise<Booking> {
    /*
     * A price the reader typed is what the line cost, not a rate.
     *
     * Without this, correcting a hotel row to the $800 actually paid would
     * quietly become $800 a night. Only a patch that sets `price` without
     * saying what it measures clears the basis; one that sets both is taken at
     * its word.
     *
     * `null`, not `undefined` — the same trap `toPatch` fell into. An
     * `undefined` here is dropped by `JSON.stringify`, so the server would
     * hear nothing about the basis and correctly leave it in place, turning
     * the corrected total back into a nightly rate.
     */
    const settled =
      patch.price !== undefined && patch.priceBasis === undefined
        ? { ...patch, priceBasis: null }
        : patch;

    try {
      return await http.patch<Booking>(`/bookings/${encodeURIComponent(id)}`, settled);
    } catch (error) {
      return rethrowBookingError(error, { id, title: patch.title });
    }
  },

  /**
   * Files every stop on a planned trip as a booking, in one write.
   *
   * Called once, when a trip the planner wrote is saved. Every row lands
   * `saved`, never `booked`: nothing has been reserved, and the prices come
   * through flagged `sample` so the trip's headline still reads "estimated".
   *
   * Idempotent, because `createTrip` is — saving the same draft twice returns
   * the same trip, and this must not then double its bookings. The stops
   * already filed are skipped here, and the server refuses any that slip
   * through. One request rather than a dozen, so a trip cannot end up half
   * recorded.
   */
  async createFromItinerary(trip: Trip): Promise<Booking[]> {
    const existing = await bookingService.getBookings();
    const filed = new Set(
      existing
        .filter((booking) => booking.tripId === trip.id)
        .map((booking) => booking.source?.resultId)
        .filter((resultId): resultId is string => resultId !== undefined),
    );

    const drafts: BookingDraft[] = [];

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

        drafts.push(draft);
      }
    }

    if (drafts.length === 0) return [];

    // Schedule order, not reversed. The store is newest-first and
    // `groupBookingsByDate` keeps a group in array order, so sending the batch
    // as it runs is what makes day one's morning read before its afternoon.
    return http.post<Booking[]>('/bookings', { bookings: drafts.map(toBody) });
  },

  /** Idempotent: removing one already gone is a success. */
  async remove(id: string): Promise<void> {
    await http.delete<void>(`/bookings/${encodeURIComponent(id)}`);
  },

  /** Files a booking against a trip, or against none when `tripId` is null. */
  async attach(id: string, tripId: string | null): Promise<Booking> {
    return bookingService.update(id, { tripId });
  },

  async setStatus(id: string, status: BookingStatus): Promise<Booking> {
    return bookingService.update(id, { status });
  },
};

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
