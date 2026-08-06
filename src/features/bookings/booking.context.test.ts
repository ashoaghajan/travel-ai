/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '../../types/trip.types';
import type { FlightSearchQuery } from '../../types/travel.types';
import { airportService } from '../../services/airport.service';
import { NO_TRIP, resolveBookingContext, toFlightQuery } from './booking.context';

/**
 * The merge between the trip being filled for and the last flight search.
 *
 * `toBookingContext` resolves the destination city through
 * `airportService.resolve`, which reads the airports the reader has picked —
 * so the tests that care about the city seed that list first.
 */

const SEARCH: FlightSearchQuery = {
  tripType: 'round-trip',
  from: 'EVN',
  to: 'DXB',
  departDate: '2027-09-11',
  returnDate: '2027-09-18',
  travellers: 1,
};

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Dubai break',
    destination: 'Dubai',
    destinationCity: 'Dubai',
    startDate: '2027-10-02',
    endDate: '2027-10-06',
    travellers: 3,
    coverImage: '/x.jpg',
    itinerary: [],
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

beforeEach(() => {
  airportService.remember({ code: 'DXB', city: 'Dubai', name: 'Dubai Intl', countryCode: 'AE' });
});

describe('choosing the trip', () => {
  it('uses the requested trip over the active one', () => {
    const trips = [makeTrip(), makeTrip({ id: 'trip_2', title: 'Other' })];
    const resolved = resolveBookingContext(trips, 'trip_1', SEARCH, 'trip_2');

    expect(resolved.trip?.id).toBe('trip_2');
    expect(resolved.source).toBe('requested');
  });

  it('falls back to the trip last opened', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, null);

    expect(resolved.trip?.id).toBe('trip_1');
    expect(resolved.source).toBe('trip');
  });

  it('detaches on the sentinel, even with an active trip', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, NO_TRIP);

    expect(resolved.trip).toBeNull();
    expect(resolved.source).toBe('search');
    // The search still supplies everything it always did.
    expect(resolved.context.originCode).toBe('EVN');
    expect(resolved.context.departDate).toBe('2027-09-11');
  });

  it('falls through to the active trip when the requested one is gone', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, 'deleted-in-another-tab');

    expect(resolved.trip?.id).toBe('trip_1');
    expect(resolved.source).toBe('trip');
  });

  it('is search-only when no trip resolves', () => {
    const resolved = resolveBookingContext([], null, SEARCH, null);

    expect(resolved.trip).toBeNull();
    expect(resolved.source).toBe('search');
  });

  it('knows nothing when there is neither a trip nor a search', () => {
    const resolved = resolveBookingContext([], null, null, null);

    expect(resolved.source).toBe('none');
    expect(resolved.context.originCode).toBeNull();
  });

  it('detaching with no search at all still reports nothing known', () => {
    expect(resolveBookingContext([], null, null, NO_TRIP).source).toBe('none');
  });
});

describe('merging the fields', () => {
  it('always takes the origin from the search, never the trip', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, null);

    expect(resolved.context.originCode).toBe('EVN');
  });

  it('has no origin when the search has none', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', null, null);

    expect(resolved.context.originCode).toBeNull();
  });

  it('takes dates and travellers from the trip', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, null);

    expect(resolved.context.departDate).toBe('2027-10-02');
    expect(resolved.context.returnDate).toBe('2027-10-06');
    expect(resolved.context.travellers).toBe(3);
  });

  it('takes the destination city from the trip', () => {
    const trip = makeTrip({ destinationCity: 'Ubud', destination: 'Ubud' });
    const resolved = resolveBookingContext([trip], 'trip_1', SEARCH, null);

    expect(resolved.context.destinationCity).toBe('Ubud');
  });

  it('reads an old trip that only carries `destination`', () => {
    const trip = makeTrip({ destinationCity: undefined, destination: 'Ubud' });

    expect(resolveBookingContext([trip], 'trip_1', SEARCH, null).context.destinationCity).toBe(
      'Ubud',
    );
  });

  it('keeps the searched airport when it is in the trip’s own city', () => {
    const resolved = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, null);

    expect(resolved.context.destinationCode).toBe('DXB');
  });

  it('drops the searched airport when the trip goes somewhere else', () => {
    // The rule that stops a leftover DXB producing a confident, wrong search
    // for a trip to Barcelona.
    const trip = makeTrip({ destinationCity: 'Barcelona', destination: 'Barcelona' });
    const resolved = resolveBookingContext([trip], 'trip_1', SEARCH, null);

    expect(resolved.context.destinationCode).toBeNull();
    expect(resolved.context.destinationCity).toBe('Barcelona');
  });

  it('matches a city regardless of case and spacing', () => {
    const trip = makeTrip({ destinationCity: '  dubai ', destination: 'Dubai' });

    expect(resolveBookingContext([trip], 'trip_1', SEARCH, null).context.destinationCode).toBe(
      'DXB',
    );
  });

  it('drops the airport when the trip names nowhere', () => {
    const trip = makeTrip({ destinationCity: '', destination: '' });
    const resolved = resolveBookingContext([trip], 'trip_1', SEARCH, null);

    expect(resolved.context.destinationCode).toBeNull();
    // Nothing better to offer, so the search's own city stands.
    expect(resolved.context.destinationCity).toBe('Dubai');
  });

  it('calls a trip with an end date a round trip', () => {
    const search: FlightSearchQuery = { ...SEARCH, tripType: 'one-way' };

    expect(resolveBookingContext([makeTrip()], 'trip_1', search, null).context.tripType).toBe(
      'round-trip',
    );
  });

  it('keeps the search’s trip type for a single-day trip', () => {
    const trip = makeTrip({ startDate: '2027-10-02', endDate: '2027-10-02' });
    const search: FlightSearchQuery = { ...SEARCH, tripType: 'one-way' };

    expect(resolveBookingContext([trip], 'trip_1', search, null).context.tripType).toBe('one-way');
  });

  it('keeps the search’s travellers when the trip records none', () => {
    const trip = makeTrip({ travellers: 0 });
    const search: FlightSearchQuery = { ...SEARCH, travellers: 4 };

    expect(resolveBookingContext([trip], 'trip_1', search, null).context.travellers).toBe(4);
  });

  it('keeps the search’s dates when the trip has none', () => {
    const trip = makeTrip({ startDate: '', endDate: '' });
    const resolved = resolveBookingContext([trip], 'trip_1', SEARCH, null);

    expect(resolved.context.departDate).toBe('2027-09-11');
    expect(resolved.context.returnDate).toBe('2027-09-18');
  });
});

describe('toFlightQuery', () => {
  it('turns a resolved context back into a search the form can open on', () => {
    const { context } = resolveBookingContext([makeTrip()], 'trip_1', SEARCH, null);

    expect(toFlightQuery(context)).toEqual({
      tripType: 'round-trip',
      from: 'EVN',
      to: 'DXB',
      departDate: '2027-10-02',
      returnDate: '2027-10-06',
      travellers: 3,
    });
  });

  it('empties the fields nothing is known for', () => {
    const { context } = resolveBookingContext([], null, null, null);

    expect(toFlightQuery(context)).toMatchObject({ from: '', to: '', departDate: '' });
  });
});
