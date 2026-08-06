import { describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { ItineraryDay, LatLng, Trip } from '../types/trip.types';
import {
  calculateTripCosts,
  formatDayCount,
  formatNightCount,
  formatTravellers,
  formatTripTotal,
  groupItineraryStops,
  tripTotal,
} from './trip';

function day(dayNumber: number, destination: string, activityPrices: number[] = []): ItineraryDay {
  return {
    id: `day-${dayNumber}`,
    dayNumber,
    date: `2027-06-0${dayNumber}`,
    destination,
    summary: `Day ${dayNumber}`,
    activities: activityPrices.map((priceEstimate, index) => ({
      id: `activity-${dayNumber}-${index}`,
      time: '09:00',
      title: 'Something',
      description: 'A thing to do',
      category: 'nature' as const,
      priceEstimate,
    })),
  };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    title: 'Bali Adventure',
    destination: 'Bali',
    startDate: '2027-06-01',
    endDate: '2027-06-07',
    travellers: 2,
    coverImage: '/bali.jpg',
    itinerary: [day(1, 'Ubud', [25, 15]), day(2, 'Ubud', [10])],
    flightsEstimate: 2248,
    hotelsEstimate: 1080,
    activitiesEstimate: 570,
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatTravellers', () => {
  it('uses the singular for one', () => {
    expect(formatTravellers(1)).toBe('1 Traveller');
  });

  it('uses the plural otherwise', () => {
    expect(formatTravellers(2)).toBe('2 Travellers');
    expect(formatTravellers(0)).toBe('0 Travellers');
  });
});

describe('formatDayCount and formatNightCount', () => {
  it('pluralises days', () => {
    expect(formatDayCount(1)).toBe('1 day');
    expect(formatDayCount(7)).toBe('7 days');
  });

  it('pluralises nights', () => {
    expect(formatNightCount(1)).toBe('1 night');
    expect(formatNightCount(6)).toBe('6 nights');
  });
});

describe('groupItineraryStops', () => {
  it('merges consecutive days at the same destination', () => {
    const stops = groupItineraryStops([day(1, 'Ubud'), day(2, 'Ubud'), day(3, 'Nusa Penida')]);

    expect(stops.map((stop) => stop.label)).toEqual(['Day 1-2 Ubud', 'Day 3 Nusa Penida']);
  });

  it('records the day numbers behind each stop', () => {
    const stops = groupItineraryStops([day(1, 'Ubud'), day(2, 'Ubud')]);

    expect(stops[0].dayNumbers).toEqual([1, 2]);
  });

  it('keeps a single day as a single stop', () => {
    const stops = groupItineraryStops([day(1, 'Ubud')]);

    expect(stops).toHaveLength(1);
    expect(stops[0].label).toBe('Day 1 Ubud');
  });

  it('does not merge a destination that is revisited later', () => {
    const stops = groupItineraryStops([day(1, 'Ubud'), day(2, 'Canggu'), day(3, 'Ubud')]);

    expect(stops.map((stop) => stop.label)).toEqual(['Day 1 Ubud', 'Day 2 Canggu', 'Day 3 Ubud']);
  });

  it('handles the full spec route', () => {
    const stops = groupItineraryStops([
      day(1, 'Ubud'),
      day(2, 'Ubud'),
      day(3, 'Nusa Penida'),
      day(4, 'Uluwatu'),
      day(5, 'Seminyak'),
      day(6, 'Canggu'),
      day(7, 'Departure'),
    ]);

    expect(stops.map((stop) => stop.label)).toEqual([
      'Day 1-2 Ubud',
      'Day 3 Nusa Penida',
      'Day 4 Uluwatu',
      'Day 5 Seminyak',
      'Day 6 Canggu',
      'Day 7 Departure',
    ]);
  });

  it('handles an empty itinerary', () => {
    expect(groupItineraryStops([])).toEqual([]);
  });

  it('does not mutate the itinerary', () => {
    const itinerary = [day(1, 'Ubud'), day(2, 'Ubud')];
    const snapshot = JSON.stringify(itinerary);

    groupItineraryStops(itinerary);

    expect(JSON.stringify(itinerary)).toBe(snapshot);
  });
});

describe('calculateTripCosts', () => {
  it('uses the estimates stored on the trip', () => {
    const costs = calculateTripCosts(trip());

    expect(costs.flights).toBe(2248);
    expect(costs.hotels).toBe(1080);
    expect(costs.activities).toBe(570);
  });

  it('totals the three rows', () => {
    const costs = calculateTripCosts(trip());
    expect(costs.total).toBe(2248 + 1080 + 570);
  });

  it('derives nights from the date range — a 7-day trip is 6 nights', () => {
    expect(calculateTripCosts(trip()).nights).toBe(6);
  });

  it('reports no nights for a single-day trip', () => {
    const costs = calculateTripCosts(trip({ startDate: '2027-06-01', endDate: '2027-06-01' }));
    expect(costs.nights).toBe(0);
  });

  it('counts every activity in the itinerary', () => {
    expect(calculateTripCosts(trip()).activityCount).toBe(3);
  });

  it('recomputes activities when the estimate is missing', () => {
    const costs = calculateTripCosts(trip({ activitiesEstimate: undefined }));

    // (25 + 15 + 10) per person, two travellers.
    expect(costs.activities).toBe(100);
    expect(costs.total).toBe(2248 + 1080 + 100);
  });

  it('treats missing flight and hotel estimates as zero', () => {
    const costs = calculateTripCosts(
      trip({ flightsEstimate: undefined, hotelsEstimate: undefined }),
    );

    expect(costs.flights).toBe(0);
    expect(costs.hotels).toBe(0);
    expect(costs.total).toBe(570);
  });

  it('handles a trip with no itinerary', () => {
    const costs = calculateTripCosts(trip({ itinerary: [], activitiesEstimate: undefined }));

    expect(costs.activityCount).toBe(0);
    expect(costs.activities).toBe(0);
  });
});

describe('groupItineraryStops coordinates', () => {
  /** A day whose activities carry points, the way an explorer import does. */
  function mapped(
    dayNumber: number,
    destination: string,
    points: (LatLng | undefined)[],
  ): ItineraryDay {
    return {
      ...day(dayNumber, destination),
      activities: points.map((coordinates, index) => ({
        id: `activity-${dayNumber}-${index}`,
        time: '09:00',
        title: 'Something',
        description: 'A thing to do',
        category: 'nature' as const,
        coordinates,
      })),
    };
  }

  it('has no coordinates when nothing in the itinerary does', () => {
    const stops = groupItineraryStops([day(1, 'Ubud'), day(2, 'Ubud')]);

    expect(stops[0].coordinates).toBeUndefined();
  });

  it('takes a single activity point as the stop point', () => {
    const stops = groupItineraryStops([mapped(1, 'Ubud', [{ lat: -8.5, lng: 115.26 }])]);

    expect(stops[0].coordinates).toEqual({ lat: -8.5, lng: 115.26 });
  });

  it('averages the activities across every day of the stop', () => {
    const stops = groupItineraryStops([
      mapped(1, 'Ubud', [{ lat: 0, lng: 0 }]),
      mapped(2, 'Ubud', [{ lat: 10, lng: 20 }]),
    ]);

    expect(stops).toHaveLength(1);
    expect(stops[0].coordinates).toEqual({ lat: 5, lng: 10 });
  });

  it('ignores activities that carry no point', () => {
    const stops = groupItineraryStops([
      mapped(1, 'Ubud', [{ lat: 4, lng: 8 }, undefined]),
    ]);

    expect(stops[0].coordinates).toEqual({ lat: 4, lng: 8 });
  });

  // A day that states its own position outranks anything inferred from what
  // happened to be planned there.
  it("prefers the day's own point over its activities", () => {
    const stops = groupItineraryStops([
      { ...mapped(1, 'Ubud', [{ lat: 50, lng: 50 }]), coordinates: { lat: 1, lng: 2 } },
    ]);

    expect(stops[0].coordinates).toEqual({ lat: 1, lng: 2 });
  });

  it('keeps each stop of a multi-city trip on its own point', () => {
    const stops = groupItineraryStops([
      mapped(1, 'Ubud', [{ lat: -8.5, lng: 115.26 }]),
      mapped(2, 'Canggu', [{ lat: -8.64, lng: 115.13 }]),
    ]);

    expect(stops.map((stop) => stop.coordinates)).toEqual([
      { lat: -8.5, lng: 115.26 },
      { lat: -8.64, lng: 115.13 },
    ]);
  });
});

/* ------------------------------------------------------------- trip totals */

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    tripId: 'trip-1',
    kind: 'hotel',
    status: 'saved',
    title: 'Somewhere to sleep',
    date: '2027-06-01',
    reference: '',
    price: 100,
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

describe('tripTotal', () => {
  it('prefers what the reader saved over what the planner guessed', () => {
    const total = tripTotal(trip(), [booking({ price: 200 })]);

    expect(total).toMatchObject({ basis: 'bookings', amount: 200 });
  });

  /*
   * Shortlisted rows count. The question the number answers is "what would
   * this trip cost me?", which is asked while deciding, not after committing.
   */
  it('counts a shortlisted booking, not only a booked one', () => {
    expect(tripTotal(trip(), [booking({ status: 'saved', price: 200 })]).amount).toBe(200);
  });

  it('falls back to the estimate when nothing saved carries a price', () => {
    const total = tripTotal(trip(), [booking({ price: undefined })]);

    expect(total).toMatchObject({ basis: 'estimate', amount: 2248 + 1080 + 570 });
  });

  it('falls back to the estimate when nothing is saved at all', () => {
    expect(tripTotal(trip(), []).basis).toBe('estimate');
  });

  /*
   * A hand-made trip stores no estimates on purpose, so `calculateTripCosts`
   * comes back at zero. Reporting that as a total would be a confident claim
   * that the trip is free.
   */
  it('claims nothing for a trip with neither bookings nor estimates', () => {
    const bare = trip({
      flightsEstimate: undefined,
      hotelsEstimate: undefined,
      activitiesEstimate: undefined,
      itinerary: [],
    });

    expect(tripTotal(bare, []).basis).toBe('none');
  });

  // $0 is a recorded fact — a free walking tour — not a missing price.
  it('treats a zero-priced booking as an answer', () => {
    expect(tripTotal(trip(), [booking({ price: 0 })])).toMatchObject({
      basis: 'bookings',
      amount: 0,
    });
  });

  it('uses the trip for rows saved before a basis was recorded', () => {
    // 6 nights on this trip, and the row predates `priceBasis`.
    const legacy = booking({
      price: 100,
      source: { provider: 'hotels', resultId: 'h', capturedAt: 'x' },
    });

    expect(tripTotal(trip(), [legacy]).amount).toBe(600);
  });
});

describe('formatTripTotal', () => {
  it('says what a saved total is', () => {
    expect(formatTripTotal(tripTotal(trip(), [booking({ price: 828 })]))).toBe('$828 saved');
  });

  it('says when it is only an estimate', () => {
    expect(formatTripTotal(tripTotal(trip(), []))).toBe('$3,898 estimated');
  });

  it('says nothing when there is nothing to claim', () => {
    const bare = trip({
      flightsEstimate: undefined,
      hotelsEstimate: undefined,
      activitiesEstimate: undefined,
      itinerary: [],
    });

    expect(formatTripTotal(tripTotal(bare, []))).toBeNull();
  });

  it('will not call a total built on an invented price "saved"', () => {
    const guessed = booking({
      price: 40,
      source: {
        provider: 'itinerary',
        resultId: 'act_1',
        priceSource: 'sample',
        capturedAt: 'x',
      },
    });

    // The figure is still the bookings', not the planner's whole-trip estimate
    // — but nobody has spent it, so it must not read as money committed.
    expect(formatTripTotal(tripTotal(trip(), [guessed]))).toBe('$40 estimated');
  });

  it('lets one invented price taint a total that also holds a real one', () => {
    const guessed = booking({
      id: 'b_guess',
      price: 40,
      source: {
        provider: 'itinerary',
        resultId: 'act_1',
        priceSource: 'sample',
        capturedAt: 'x',
      },
    });

    // Still tainted: one guess in the sum is enough, whatever else is in it.
    expect(formatTripTotal(tripTotal(trip(), [guessed, booking({ price: 828 })]))).toBe(
      '$868 estimated',
    );
  });
});
