/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { Booking, BookingDraft } from '../types/booking.types';
import type { Activity, BookingContext, Flight, Hotel, Partner } from '../types/travel.types';
import type { ItineraryDay, Trip } from '../types/trip.types';
import {
  BookingAlreadyOnTripError,
  BookingNotFoundError,
  activityToBookingDraft,
  bookingService,
  flightToBookingDrafts,
  hotelToBookingDraft,
  isResultOnTrip,
  itineraryActivityToBookingDraft,
  partnerToBookingDraft,
} from './booking.service';
import { ApiError, http } from './http';

/**
 * Bookings, now that they live in Postgres.
 *
 * The persistence this file used to test — writing to `localStorage`, reading
 * it back, dropping a hand-edited row, evicting when the quota filled — moved
 * to `server/src/modules/bookings/`, where it runs against a real database.
 * Two of those behaviours are simply gone: the 500-row cap existed because
 * these shared a 5MB quota with the reader's trips, and the tolerance for a
 * half-written entry existed because storage can be edited by hand.
 *
 * What is left here is what this file still owns: the requests it makes, the
 * mapping of an API failure back to the error classes components branch on,
 * and the mappers that turn a fare or an attraction into a booking draft —
 * which never went anywhere near the server.
 */

function makeDraft(overrides: Partial<BookingDraft> = {}): BookingDraft {
  return {
    tripId: 'trip_1',
    kind: 'hotel',
    status: 'saved',
    title: 'Hotel Indigo',
    date: '2027-05-20',
    reference: '',
    ...overrides,
  };
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    ...makeDraft(),
    id: 'bkg_1',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CONTEXT: BookingContext = {
  tripType: 'round-trip',
  originCode: 'EVN',
  destinationCode: 'DXB',
  destinationCity: 'Dubai',
  destinationCountry: 'United Arab Emirates',
  departDate: '2027-09-11',
  returnDate: '2027-09-18',
  travellers: 2,
};

/** The day an itinerary stop is read off, for the planner-side mapper. */
const DAY: ItineraryDay = {
  id: 'day_2',
  dayNumber: 2,
  date: '2027-05-21',
  destination: 'Yerevan',
  summary: 'Old town and the cascade',
  activities: [],
};

function apiFails(code: string, status = 400) {
  return new ApiError(status, code as never, 'Nope.');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getBookings', () => {
  it('asks the bookings endpoint', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([makeBooking()]);

    await expect(bookingService.getBookings()).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/bookings');
  });
});

describe('create', () => {
  it('posts the draft', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(makeBooking());

    await bookingService.create(makeDraft());

    expect(post).toHaveBeenCalledWith('/bookings', expect.objectContaining({
      title: 'Hotel Indigo',
      kind: 'hotel',
      tripId: 'trip_1',
    }));
  });

  it('reports a repeat as BookingAlreadyOnTripError, naming it', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(apiFails(ERROR_CODES.BOOKING_ALREADY_ON_TRIP, 409));

    const caught = await bookingService.create(makeDraft()).catch((error) => error);

    // Enforced server-side now, which is what makes it hold across two tabs.
    expect(caught).toBeInstanceOf(BookingAlreadyOnTripError);
    expect(caught.message).toContain('Hotel Indigo');
  });

  it('lets an unrecognised failure through untouched', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(apiFails(ERROR_CODES.NETWORK, 0));

    const caught = await bookingService.create(makeDraft()).catch((error) => error);

    // A dead network is not "already on the trip".
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).not.toBeInstanceOf(BookingAlreadyOnTripError);
  });
});

describe('update', () => {
  it('patches the booking', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeBooking({ reference: 'ABC123' }));

    await bookingService.update('bkg_1', { reference: 'ABC123' });

    expect(patch).toHaveBeenCalledWith('/bookings/bkg_1', { reference: 'ABC123' });
  });

  it('clears the basis when a price is typed without one', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeBooking());

    await bookingService.update('bkg_1', { price: 800 });

    /*
     * `null`, not `undefined`. A price the reader typed is what the line cost,
     * not a rate — and an `undefined` here is dropped by JSON.stringify, so
     * the server would leave the nightly basis in place and quietly turn the
     * $800 actually paid into $800 a night.
     */
    expect(patch).toHaveBeenCalledWith('/bookings/bkg_1', { price: 800, priceBasis: null });
  });

  it('takes a patch that sets both at its word', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeBooking());
    const basis = { unit: 'nightly' as const, units: 4 };

    await bookingService.update('bkg_1', { price: 116, priceBasis: basis });

    expect(patch).toHaveBeenCalledWith('/bookings/bkg_1', { price: 116, priceBasis: basis });
  });

  it('reports a missing booking as BookingNotFoundError', async () => {
    vi.spyOn(http, 'patch').mockRejectedValue(apiFails(ERROR_CODES.BOOKING_NOT_FOUND, 404));

    await expect(bookingService.update('bkg_gone', {})).rejects.toBeInstanceOf(
      BookingNotFoundError,
    );
  });
});

describe('attach and setStatus', () => {
  it('files a booking against a trip', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeBooking());

    await bookingService.attach('bkg_1', 'trip_2');

    expect(patch).toHaveBeenCalledWith('/bookings/bkg_1', { tripId: 'trip_2' });
  });

  it('detaches with an explicit null', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeBooking());

    await bookingService.attach('bkg_1', null);

    // Same trap as everywhere else: `undefined` would mean "leave it".
    expect(patch).toHaveBeenCalledWith('/bookings/bkg_1', { tripId: null });
  });

  it('marks a booking booked', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(makeBooking());

    await bookingService.setStatus('bkg_1', 'booked');

    expect(patch).toHaveBeenCalledWith('/bookings/bkg_1', { status: 'booked' });
  });
});

describe('remove', () => {
  it('deletes the booking', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await bookingService.remove('bkg_1');

    expect(remove).toHaveBeenCalledWith('/bookings/bkg_1');
  });
});

describe('createFromItinerary', () => {
  function tripWithStops(): Trip {
    return {
      id: 'trip_1',
      title: 'Yerevan',
      destination: 'Yerevan',
      startDate: '2027-05-20',
      endDate: '2027-05-22',
      travellers: 2,
      coverImage: '/y.jpg',
      itinerary: [
        {
          id: 'day_1',
          dayNumber: 1,
          date: '2027-05-20',
          destination: 'Yerevan',
          summary: 'Arrival',
          activities: [
            {
              id: 'act_1',
              time: '09:00',
              title: 'Cascade at opening',
              description: 'Before the heat.',
              category: 'culture',
              sourceActivityId: 'otm_cascade',
            },
            {
              id: 'act_2',
              time: '14:00',
              title: 'Ararat tour',
              description: 'Brandy and the view.',
              category: 'culture',
              sourceActivityId: 'otm_ararat',
            },
          ],
        },
      ],
      createdAt: 'x',
      updatedAt: 'x',
    };
  }

  it('files every stop in one request', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([]);
    const post = vi.spyOn(http, 'post').mockResolvedValue([]);

    await bookingService.createFromItinerary(tripWithStops());

    // One request, not a dozen: a trip must not end up half recorded.
    expect(post).toHaveBeenCalledTimes(1);
    const sent = post.mock.calls[0][1] as { bookings: BookingDraft[] };
    expect(sent.bookings.map((booking) => booking.title)).toEqual([
      'Cascade at opening',
      'Ararat tour',
    ]);
  });

  it('sends them in schedule order', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([]);
    const post = vi.spyOn(http, 'post').mockResolvedValue([]);

    await bookingService.createFromItinerary(tripWithStops());

    // The list is newest-first and a date group keeps array order, so this is
    // what makes day one's morning read before its afternoon.
    const sent = post.mock.calls[0][1] as { bookings: BookingDraft[] };
    expect(sent.bookings[0].title).toBe('Cascade at opening');
  });

  it('skips a stop already filed against this trip', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([
      makeBooking({ tripId: 'trip_1', source: { provider: 'otm', resultId: 'otm_cascade', capturedAt: 'x' } }),
    ]);
    const post = vi.spyOn(http, 'post').mockResolvedValue([]);

    await bookingService.createFromItinerary(tripWithStops());

    // Saving the same draft twice returns the same trip, and this must not
    // then double its bookings.
    const sent = post.mock.calls[0][1] as { bookings: BookingDraft[] };
    expect(sent.bookings.map((booking) => booking.title)).toEqual(['Ararat tour']);
  });

  it('makes no request when there is nothing left to file', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([
      makeBooking({ id: 'a', tripId: 'trip_1', source: { provider: 'otm', resultId: 'otm_cascade', capturedAt: 'x' } }),
      makeBooking({ id: 'b', tripId: 'trip_1', source: { provider: 'otm', resultId: 'otm_ararat', capturedAt: 'x' } }),
    ]);
    const post = vi.spyOn(http, 'post').mockResolvedValue([]);

    await expect(bookingService.createFromItinerary(tripWithStops())).resolves.toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('files everything as saved, never booked', async () => {
    vi.spyOn(http, 'get').mockResolvedValue([]);
    const post = vi.spyOn(http, 'post').mockResolvedValue([]);

    await bookingService.createFromItinerary(tripWithStops());

    // Nothing has been reserved — the planner cannot reserve anything — so the
    // trip's headline still has to read "estimated".
    const sent = post.mock.calls[0][1] as { bookings: BookingDraft[] };
    expect(sent.bookings.every((booking) => booking.status === 'saved')).toBe(true);
  });
});

describe('isResultOnTrip', () => {
  const bookings: Booking[] = [
    {
      ...makeDraft({
        source: { provider: 'hotels', resultId: 'h1', capturedAt: 'x' },
      }),
      id: 'b1',
      createdAt: 'x',
      updatedAt: 'x',
    },
  ];

  it('is true for the same result on the same trip', () => {
    expect(isResultOnTrip(bookings, 'trip_1', 'h1')).toBe(true);
  });

  it('is false on another trip', () => {
    expect(isResultOnTrip(bookings, 'trip_2', 'h1')).toBe(false);
  });

  it('is false with no trip to compare against', () => {
    expect(isResultOnTrip(bookings, null, 'h1')).toBe(false);
  });

  it('is false for a result nobody attached', () => {
    expect(isResultOnTrip(bookings, 'trip_1', 'other')).toBe(false);
  });
});

describe('mappers', () => {
  const flight: Flight = {
    id: 'f1',
    airline: 'Air Arabia',
    from: 'EVN',
    to: 'DXB',
    departureTime: '12:00 PM',
    arrivalTime: '3:00 PM',
    departureDate: '2027-09-12',
    returnDate: null,
    duration: '3h',
    stops: 0,
    price: 368,
    durationMinutes: 180,
    bookingUrl: 'https://example.com/fare',
  };

  const ROUND_TRIP_LEG = {
    departureTime: '6:40 AM',
    arrivalTime: '9:55 AM',
    date: '2027-09-18',
    duration: '3h 15m',
    durationMinutes: 195,
    stops: 0,
  };

  it('splits a round trip into one booking per flight', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, price: 363, returnDate: '2027-09-18', returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ title: 'Air Arabia · EVN → DXB', date: '2027-09-12' });
    expect(drafts[1]).toMatchObject({ title: 'Air Arabia · DXB → EVN', date: '2027-09-18' });
  });

  it('halves the fare so the two still sum to what was quoted', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, price: 363, returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect(drafts[0].price).toBe(181.5);
    expect(drafts[1].price).toBe(181.5);
    expect((drafts[0].price ?? 0) + (drafts[1].price ?? 0)).toBe(363);
  });

  /*
   * Both halves are per-person, so the two legs times the party come back to
   * the quoted fare times the party — the halving and the basis are
   * independent, and confusing them would double or halve the whole trip.
   */
  /*
   * The map needs the codes, and cannot take them from the title: that is an
   * editable field, so a reader renaming a row to "Flight home" would
   * otherwise take its pins off the map.
   */
  it('records the route each leg flies, reversed on the way back', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, price: 363, returnDate: '2027-09-18', returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect(drafts[0].source?.route).toEqual({ from: 'EVN', to: 'DXB' });
    expect(drafts[1].source?.route).toEqual({ from: 'DXB', to: 'EVN' });
  });

  it('marks both legs as priced per passenger', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, price: 363, returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect(drafts[0].priceBasis).toEqual({ unit: 'perPerson', units: 2 });
    expect(drafts[1].priceBasis).toEqual({ unit: 'perPerson', units: 2 });

    const total = drafts.reduce(
      (sum, draft) => sum + (draft.price ?? 0) * (draft.priceBasis?.units ?? 1),
      0,
    );
    expect(total).toBe(726);
  });

  it('sums back exactly on a fare that does not halve cleanly', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, price: 363.01, returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect((drafts[0].price ?? 0) + (drafts[1].price ?? 0)).toBe(363.01);
  });

  it('says the price is half a round trip, so it does not read as a seat price', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, price: 363, returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect(drafts[0].source?.subtitle).toContain('half of a $363 round trip');
    expect(drafts[1].source?.subtitle).toContain('half of a $363 round trip');
  });

  it('gives each leg its own result id, or the second would read as a duplicate', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, returnLeg: ROUND_TRIP_LEG },
      CONTEXT,
      'trip_1',
    );

    expect(drafts[0].source?.resultId).toBe('f1');
    expect(drafts[1].source?.resultId).toBe('f1:return');
  });

  it('records a one-way as a single booking at the full price', () => {
    const drafts = flightToBookingDrafts(flight, CONTEXT, 'trip_1');

    expect(drafts).toHaveLength(1);
    expect(drafts[0].price).toBe(368);
    expect(drafts[0].source?.subtitle).toBe('12:00 PM – 3:00 PM · 3h');
  });

  it('falls back to the searched return date when the fare names none', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, returnLeg: { ...ROUND_TRIP_LEG, date: null } },
      CONTEXT,
      'trip_1',
    );

    expect(drafts[1].date).toBe('2027-09-18');
  });

  it('stays one booking when the return has no day to sit under', () => {
    const drafts = flightToBookingDrafts(
      { ...flight, returnLeg: { ...ROUND_TRIP_LEG, date: null } },
      { ...CONTEXT, returnDate: null },
      'trip_1',
    );

    // A row with no date is not something anyone can act on.
    expect(drafts).toHaveLength(1);
    expect(drafts[0].price).toBe(368);
  });

  it('files a fare under the day it actually departs, not the day searched', () => {
    const [draft] = flightToBookingDrafts(flight, CONTEXT, 'trip_1', 'live');

    // The searched date was the 11th; this fare leaves on the 12th.
    expect(draft.date).toBe('2027-09-12');
    expect(draft.kind).toBe('flight');
    expect(draft.status).toBe('saved');
    expect(draft.source?.bookingUrl).toBe('https://example.com/fare');
    expect(draft.source?.priceSource).toBe('live');
  });

  it('falls back to the searched date when the fare does not name one', () => {
    const [draft] = flightToBookingDrafts(
      { ...flight, departureDate: null },
      CONTEXT,
      null,
    );

    expect(draft.date).toBe('2027-09-11');
    expect(draft.tripId).toBeNull();
  });

  it('turns a null booking url into an absent one', () => {
    const [draft] = flightToBookingDrafts({ ...flight, bookingUrl: null }, CONTEXT, null);

    expect(draft.source?.bookingUrl).toBeUndefined();
  });

  it('maps a hotel, carrying an unpriced listing through as no price', () => {
    const hotel: Hotel = {
      id: 'h1',
      name: 'Hotel Indigo',
      location: 'Ubud',
      category: 'Luxury Resort',
      rating: 4.6,
      reviews: 120,
      pricePerNight: null,
      image: 'https://example.com/h.jpg',
      bookingUrl: null,
    };
    const draft = hotelToBookingDraft(hotel, CONTEXT, 'trip_1', 'listing');

    expect(draft.kind).toBe('hotel');
    expect(draft.price).toBeUndefined();
    expect(draft.source?.image).toBe('https://example.com/h.jpg');
    expect(draft.source?.subtitle).toBe('Luxury Resort · Ubud');
  });

  it('maps a hotel that does carry a rate', () => {
    const hotel: Hotel = {
      id: 'h2',
      name: 'Priced',
      location: 'Ubud',
      category: 'Hotel',
      rating: 4,
      reviews: 10,
      pricePerNight: 180,
      image: 'x',
      bookingUrl: 'https://example.com/stay',
    };

    const draft = hotelToBookingDraft(hotel, CONTEXT, 'trip_1');

    expect(draft.price).toBe(180);
    // A nightly rate, and CONTEXT is a seven-night stay. Without the basis a
    // total would count one night of it.
    expect(draft.priceBasis).toEqual({ unit: 'nightly', units: 7 });
  });

  // Pinned exactly rather than geocoded from a name, which fails outright for
  // the small properties a directory lists but a gazetteer has never heard of.
  it('keeps a stay\'s own coordinates for the map', () => {
    const hotel: Hotel = {
      id: 'h5',
      name: 'Placed',
      location: 'Ubud',
      category: 'Hotel',
      rating: 4,
      reviews: 10,
      pricePerNight: 90,
      image: 'x',
      bookingUrl: null,
      coordinates: { lat: 40.1792, lng: 44.4991 },
    };

    expect(hotelToBookingDraft(hotel, CONTEXT, 'trip_1').source?.coordinates).toEqual({
      lat: 40.1792,
      lng: 44.4991,
    });
  });

  it('records no basis for a stay nobody quoted', () => {
    const hotel: Hotel = {
      id: 'h3',
      name: 'Unpriced',
      location: 'Ubud',
      category: 'Hotel',
      rating: 4,
      reviews: 10,
      pricePerNight: null,
      image: 'x',
      bookingUrl: null,
    };

    expect(hotelToBookingDraft(hotel, CONTEXT, 'trip_1').priceBasis).toBeUndefined();
  });

  it('falls back to one night when the dates are unknown', () => {
    const hotel: Hotel = {
      id: 'h4',
      name: 'Dateless',
      location: 'Ubud',
      category: 'Hotel',
      rating: 4,
      reviews: 10,
      pricePerNight: 90,
      image: 'x',
      bookingUrl: null,
    };

    const draft = hotelToBookingDraft(
      hotel,
      { ...CONTEXT, departDate: null, returnDate: null },
      'trip_1',
    );

    expect(draft.priceBasis).toEqual({ unit: 'nightly', units: 1 });
  });

  it('reads an activity price of zero as no price known', () => {
    const activity: Activity = {
      id: 'a1',
      title: 'Desert safari',
      category: 'adventure',
      description: 'Dunes.',
      price: 0,
      rating: 0,
      reviews: 0,
      image: 'https://example.com/a.jpg',
    };
    const draft = activityToBookingDraft(activity, CONTEXT, 'trip_1');

    expect(draft.kind).toBe('activity');
    expect(draft.price).toBeUndefined();
    expect(draft.source?.price).toBeUndefined();
  });

  it('keeps an activity price when there is one', () => {
    const activity: Activity = {
      id: 'a2',
      title: 'Boat trip',
      category: 'nature',
      description: '',
      price: 45,
      rating: 0,
      reviews: 0,
      image: '',
      sourceUrl: 'https://example.com/a2',
    };
    const draft = activityToBookingDraft(activity, CONTEXT, 'trip_1');

    expect(draft.price).toBe(45);
    expect(draft.source?.bookingUrl).toBe('https://example.com/a2');
  });

  it('carries the planner’s estimate as a sample price, never as a fare', () => {
    const draft = itineraryActivityToBookingDraft(
      {
        id: 'act_1',
        time: '08:30',
        title: 'Full-day snorkel and sandbank trip',
        description: 'Shared boat trips run daily from the jetty.',
        category: 'adventure',
        priceEstimate: 40,
      },
      DAY,
      'trip_1',
      2,
    );

    expect(draft.price).toBe(40);
    // Per head, so it multiplies out the way a fare does.
    expect(draft.priceBasis).toEqual({ unit: 'perPerson', units: 2 });
    // The flag that keeps the trip's headline saying "estimated" — without it
    // eleven guesses would add up to a figure labelled as money spent.
    expect(draft.source?.priceSource).toBe('sample');

    expect(draft.kind).toBe('activity');
    expect(draft.status).toBe('saved');
    // The day's date, not the trip's start — a stop happens when it happens.
    expect(draft.date).toBe('2027-05-21');
    expect(draft.source?.resultId).toBe('act_1');
    // Never bare: the category stands in when the stop has no photo.
    expect(draft.source?.image).toBeTruthy();
  });

  it('claims no price, and no sample flag, for an unpriced stop', () => {
    const draft = itineraryActivityToBookingDraft(
      {
        id: 'act_0',
        time: '17:30',
        title: 'Bikini Beach at sunset',
        description: 'The fenced western strip.',
        category: 'relaxation',
      },
      DAY,
      'trip_1',
      2,
    );

    expect(draft.price).toBeUndefined();
    expect(draft.priceBasis).toBeUndefined();
    expect(draft.source?.priceSource).toBeUndefined();
    // A photo regardless — that is what stops the list looking half-loaded.
    expect(draft.source?.image).toBeTruthy();
  });

  it('reads a planned price of zero as no price known', () => {
    const draft = itineraryActivityToBookingDraft(
      {
        id: 'act_4',
        time: '15:00',
        title: 'Check in and walk the island',
        description: '',
        category: 'relaxation',
        priceEstimate: 0,
      },
      DAY,
      'trip_1',
      2,
    );

    // Same reading `activityToBookingDraft` gives a zero — "$0" beside rows
    // that cost something is worse than saying nothing.
    expect(draft.price).toBeUndefined();
    expect(draft.source?.price).toBeUndefined();
  });

  it('files an imported stop under the id the catalogue would use', () => {
    const draft = itineraryActivityToBookingDraft(
      {
        id: 'act_2',
        time: '10:00',
        title: 'Blue Mosque',
        description: '',
        category: 'culture',
        image: 'https://example.com/mosque.jpg',
        sourceActivityId: 'otm_9931',
        coordinates: { lat: 40.1792, lng: 44.4991 },
      },
      DAY,
      'trip_1',
      2,
    );

    // So a stop added to a day and booked from the browser is one thing.
    expect(draft.source?.resultId).toBe('otm_9931');
    expect(draft.source?.coordinates).toEqual({ lat: 40.1792, lng: 44.4991 });
    // Falls back to where the day is spent when the stop says nothing.
    expect(draft.source?.subtitle).toBe('Yerevan');
    // Its own photo wins over the category stand-in.
    expect(draft.source?.image).toBe('https://example.com/mosque.jpg');
  });

  it('floors the party at one traveller', () => {
    const draft = itineraryActivityToBookingDraft(
      { id: 'act_3', time: '09:00', title: 'Tour', description: '', category: 'culture', priceEstimate: 20 },
      DAY,
      'trip_1',
      0,
    );

    expect(draft.priceBasis).toEqual({ unit: 'perPerson', units: 1 });
  });

  it('maps a partner to the kind of its tab', () => {
    const partner: Partner = {
      id: 'booking',
      name: 'Booking.com',
      description: 'Wide selection of hotels',
      categories: ['hotels'],
      brandColor: '#003580',
      brandTextColor: '#fff',
      initials: 'BK',
      linkBuilder: 'booking',
      homeUrl: 'https://booking.com',
    };
    const draft = partnerToBookingDraft(partner, 'hotels', 'https://booking.com/x', CONTEXT, 't1');

    expect(draft.kind).toBe('hotel');
    expect(draft.title).toBe('Booking.com');
    expect(draft.source?.resultId).toBe('booking:hotels');
    expect(draft.source?.bookingUrl).toBe('https://booking.com/x');
  });

  it('maps the other two partner tabs', () => {
    const partner: Partner = {
      id: 'expedia',
      name: 'Expedia',
      description: '',
      categories: ['flights', 'activities'],
      brandColor: '#000',
      brandTextColor: '#fff',
      initials: 'EX',
      linkBuilder: 'expedia',
      homeUrl: 'https://expedia.com',
    };

    expect(partnerToBookingDraft(partner, 'flights', 'u', CONTEXT, null).kind).toBe('flight');
    expect(partnerToBookingDraft(partner, 'activities', 'u', CONTEXT, null).kind).toBe('activity');
  });

  it('leaves the date empty when the search has none', () => {
    const empty: BookingContext = { ...CONTEXT, departDate: null };

    expect(hotelToBookingDraft(
      { id: 'h', name: 'n', location: '', category: '', rating: 0, reviews: 0, pricePerNight: null, image: '', bookingUrl: null },
      empty,
      null,
    ).date).toBe('');
  });
});
