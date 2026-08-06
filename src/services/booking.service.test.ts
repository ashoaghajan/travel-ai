/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Booking, BookingDraft } from '../types/booking.types';
import type { Activity, BookingContext, Flight, Hotel, Partner } from '../types/travel.types';
import type { ItineraryDay, Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
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
  readBookingsSync,
} from './booking.service';

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

beforeEach(() => {
  storageService.remove(STORAGE_KEYS.bookings);
});

describe('create', () => {
  it('stamps an id and both timestamps', async () => {
    const booking = await bookingService.create(makeDraft());

    expect(booking.id).toMatch(/^bkg_/);
    expect(booking.createdAt).toBe(booking.updatedAt);
    expect(readBookingsSync()).toHaveLength(1);
  });

  it('puts the newest first', async () => {
    await bookingService.create(makeDraft({ title: 'First' }));
    await bookingService.create(makeDraft({ title: 'Second' }));

    expect(readBookingsSync()[0].title).toBe('Second');
  });

  it('refuses the same search result twice on one trip', async () => {
    const draft = makeDraft({
      source: { provider: 'hotels', resultId: 'h1', capturedAt: '2027-01-01T00:00:00.000Z' },
    });
    await bookingService.create(draft);

    await expect(bookingService.create(draft)).rejects.toThrow(BookingAlreadyOnTripError);
  });

  it('allows the same result on a different trip', async () => {
    const source = { provider: 'hotels', resultId: 'h1', capturedAt: '2027-01-01T00:00:00.000Z' };
    await bookingService.create(makeDraft({ source }));
    await bookingService.create(makeDraft({ source, tripId: 'trip_2' }));

    expect(readBookingsSync()).toHaveLength(2);
  });

  it('allows the same result twice while it belongs to no trip', async () => {
    const source = { provider: 'hotels', resultId: 'h1', capturedAt: '2027-01-01T00:00:00.000Z' };
    await bookingService.create(makeDraft({ source, tripId: null }));
    await bookingService.create(makeDraft({ source, tripId: null }));

    expect(readBookingsSync()).toHaveLength(2);
  });

  it('never treats a hand-typed row as a duplicate', async () => {
    await bookingService.create(makeDraft());
    await bookingService.create(makeDraft());

    expect(readBookingsSync()).toHaveLength(2);
  });
});

describe('update', () => {
  it('patches and moves updatedAt', async () => {
    const created = await bookingService.create(makeDraft());
    const updated = await bookingService.update(created.id, { reference: 'BK-1' });

    expect(updated.reference).toBe('BK-1');
    expect(updated.createdAt).toBe(created.createdAt);
  });

  /*
   * A price someone types is what the line cost, not a rate. Without this,
   * correcting a nightly row to the $800 actually paid would silently become
   * $800 a night.
   */
  it('clears the basis when a price is typed over it', async () => {
    const created = await bookingService.create(
      makeDraft({ price: 116, priceBasis: { unit: 'nightly', units: 6 } }),
    );

    const updated = await bookingService.update(created.id, { price: 800 });

    expect(updated.price).toBe(800);
    expect(updated.priceBasis).toBeUndefined();
  });

  it('keeps a basis the caller set alongside the price', async () => {
    const created = await bookingService.create(makeDraft({ price: 116 }));

    const updated = await bookingService.update(created.id, {
      price: 120,
      priceBasis: { unit: 'nightly', units: 3 },
    });

    expect(updated.priceBasis).toEqual({ unit: 'nightly', units: 3 });
  });

  it('leaves the basis alone when the price is not touched', async () => {
    const basis = { unit: 'nightly', units: 6 } as const;
    const created = await bookingService.create(makeDraft({ price: 116, priceBasis: basis }));

    const updated = await bookingService.update(created.id, { reference: 'BK-9' });

    expect(updated.priceBasis).toEqual(basis);
  });

  it('throws for an id that is not there', async () => {
    await expect(bookingService.update('nope', { title: 'x' })).rejects.toThrow(
      BookingNotFoundError,
    );
  });

  it('attaches to a trip and detaches again', async () => {
    const created = await bookingService.create(makeDraft({ tripId: null }));

    expect((await bookingService.attach(created.id, 'trip_9')).tripId).toBe('trip_9');
    expect((await bookingService.attach(created.id, null)).tripId).toBeNull();
  });

  it('sets the status', async () => {
    const created = await bookingService.create(makeDraft());

    expect((await bookingService.setStatus(created.id, 'booked')).status).toBe('booked');
  });
});

describe('remove', () => {
  it('drops one and leaves the rest', async () => {
    const first = await bookingService.create(makeDraft({ title: 'First' }));
    await bookingService.create(makeDraft({ title: 'Second' }));

    await bookingService.remove(first.id);

    expect(readBookingsSync()).toHaveLength(1);
    expect(readBookingsSync()[0].title).toBe('Second');
  });

  it('is a no-op for an unknown id', async () => {
    await bookingService.create(makeDraft());
    await bookingService.remove('nope');

    expect(readBookingsSync()).toHaveLength(1);
  });
});

describe('createFromItinerary', () => {
  function planned(overrides: Partial<Trip> = {}): Trip {
    return {
      id: 'trip_1',
      title: 'Three days in the Maldives',
      destination: 'Maafushi',
      startDate: '2027-09-14',
      endDate: '2027-09-16',
      travellers: 2,
      coverImage: '/x.jpg',
      itinerary: [
        {
          id: 'day_1',
          dayNumber: 1,
          date: '2027-09-14',
          destination: 'Maafushi',
          summary: 'Ferry south',
          activities: [
            { id: 'a1', time: '09:00', title: 'Airport ferry', description: '', category: 'travel', priceEstimate: 2 },
            { id: 'a2', time: '17:30', title: 'Bikini Beach', description: '', category: 'relaxation' },
          ],
        },
        {
          id: 'day_2',
          dayNumber: 2,
          date: '2027-09-15',
          destination: 'South Malé Atoll',
          summary: 'Sandbank',
          activities: [
            { id: 'a3', time: '08:30', title: 'Snorkel trip', description: '', category: 'adventure', priceEstimate: 40 },
          ],
        },
      ],
      createdAt: 'x',
      updatedAt: 'x',
      ...overrides,
    };
  }

  it('files every stop on the schedule, shortlisted rather than booked', async () => {
    const created = await bookingService.createFromItinerary(planned());

    expect(created).toHaveLength(3);
    expect(created.every((booking) => booking.status === 'saved')).toBe(true);
    expect(created.every((booking) => booking.kind === 'activity')).toBe(true);
    // Never bare — the whole reason these look like catalogue rows.
    expect(created.every((booking) => Boolean(booking.source?.image))).toBe(true);
  });

  it('writes them in schedule order, so a day reads morning first', async () => {
    await bookingService.createFromItinerary(planned());

    // The store is newest-first and a date group keeps array order; creating
    // one at a time would stack each day backwards.
    expect(readBookingsSync().map((booking) => booking.title)).toEqual([
      'Airport ferry',
      'Bikini Beach',
      'Snorkel trip',
    ]);
  });

  it('prices a stop per head and flags the figure as a guess', async () => {
    const created = await bookingService.createFromItinerary(planned());
    const snorkel = created.find((booking) => booking.title === 'Snorkel trip');

    expect(snorkel?.price).toBe(40);
    expect(snorkel?.priceBasis).toEqual({ unit: 'perPerson', units: 2 });
    expect(snorkel?.source?.priceSource).toBe('sample');
  });

  it('adds nothing the second time the same draft is saved', async () => {
    const trip = planned();
    await bookingService.createFromItinerary(trip);

    const again = await bookingService.createFromItinerary(trip);

    expect(again).toEqual([]);
    expect(readBookingsSync()).toHaveLength(3);
  });

  it('leaves a stop alone when the reader already booked it from the catalogue', async () => {
    await bookingService.create(
      makeDraft({
        kind: 'activity',
        title: 'Snorkel trip',
        source: { provider: 'opentripmap', resultId: 'otm_9931', capturedAt: 'x' },
      }),
    );

    const trip = planned();
    const created = await bookingService.createFromItinerary({
      ...trip,
      itinerary: [
        {
          ...trip.itinerary[1],
          activities: [{ ...trip.itinerary[1].activities[0], sourceActivityId: 'otm_9931' }],
        },
      ],
    });

    expect(created).toEqual([]);
    expect(readBookingsSync()).toHaveLength(1);
  });

  it('files one booking for an attraction that sits on two days', async () => {
    const trip = planned();
    const twice: Trip = {
      ...trip,
      itinerary: trip.itinerary.map((day) => ({
        ...day,
        activities: [
          { id: `${day.id}-x`, time: '09:00', title: 'Blue Mosque', description: '', category: 'culture' as const, sourceActivityId: 'otm_1' },
        ],
      })),
    };

    // Both days name the same place, so both drafts carry one result id — and
    // `create` would refuse the second as a duplicate.
    expect(await bookingService.createFromItinerary(twice)).toHaveLength(1);
  });

  it('does nothing for a trip with no schedule', async () => {
    expect(await bookingService.createFromItinerary(planned({ itinerary: [] }))).toEqual([]);
    expect(readBookingsSync()).toEqual([]);
  });
});

describe('reading a damaged store', () => {
  it('answers with nothing when the value is not JSON', async () => {
    localStorage.setItem(STORAGE_KEYS.bookings, 'not json at all');

    expect(await bookingService.getBookings()).toEqual([]);
  });

  it('answers with nothing when the value is not an array', async () => {
    storageService.set(STORAGE_KEYS.bookings, { not: 'an array' });

    expect(await bookingService.getBookings()).toEqual([]);
  });

  it('drops rows that are the wrong shape and keeps the rest', async () => {
    const good = { ...makeDraft(), id: 'ok', createdAt: 'x', updatedAt: 'x' };
    storageService.set(STORAGE_KEYS.bookings, [
      good,
      null,
      'nonsense',
      { id: 'no-kind', tripId: null, title: 't', date: '', reference: '', createdAt: 'x' },
      { ...good, id: 'bad-status', status: 'maybe' },
      { ...good, id: 'bad-trip', tripId: 7 },
    ]);

    const kept = await bookingService.getBookings();
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('ok');
  });
});

describe('capping', () => {
  it('drops shortlisted rows before confirmed ones', async () => {
    const many: Booking[] = Array.from({ length: 500 }, (_, index) => ({
      ...makeDraft({ status: 'saved', title: `Saved ${index}` }),
      id: `saved-${index}`,
      createdAt: 'x',
      updatedAt: 'x',
    }));
    // One real reservation, oldest in the list — a newest-first cap would lose it.
    many.push({
      ...makeDraft({ status: 'booked', title: 'Real reservation' }),
      id: 'booked-1',
      createdAt: 'x',
      updatedAt: 'x',
    });
    storageService.set(STORAGE_KEYS.bookings, many);

    await bookingService.create(makeDraft({ status: 'saved', title: 'One more' }));

    const stored = readBookingsSync();
    expect(stored).toHaveLength(500);
    expect(stored.some((booking) => booking.title === 'Real reservation')).toBe(true);
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
