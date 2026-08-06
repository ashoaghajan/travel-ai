/**
 * The two priced-search services share a file: each asks the API for live
 * prices and falls back to the mock list when it cannot get them, and it is
 * that fallback — not any logic of their own — that has to be right.
 *
 * The rule these tests exist to hold: a price the reader might act on is
 * either quoted (`source: 'live'`) or admitted to be invented
 * (`source: 'sample'`), and an invented one never carries a booking link.
 *
 * (Activities are not priced this way — see `activity.service.test.ts`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { ErrorCode } from '@ai-travel/shared';
import { MOCK_FLIGHTS } from '../mock/flights';
import { MOCK_HOTELS } from '../mock/hotels';
import { flightService } from './flight.service';
import { hotelService } from './hotel.service';
import { ApiError, http } from './http';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advances past the sample path's deliberate delay. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(2000);
  return pending;
}

const FLIGHT_QUERY = {
  tripType: 'round-trip',
  from: 'JFK',
  to: 'DPS',
  departDate: '2027-05-20',
  returnDate: '2027-05-28',
  travellers: 2,
} as const;

const HOTEL_QUERY = {
  destination: 'Ubud',
  checkIn: '2027-05-20',
  checkOut: '2027-05-22',
  guests: 2,
} as const;

/** The server is unreachable, or has no provider token. */
function stubApiFailure(code: ErrorCode) {
  vi.spyOn(http, 'get').mockRejectedValue(new ApiError(503, code, 'nope'));
}

describe('flightService', () => {
  describe('when the API answers', () => {
    it('passes the quoted fares and their provenance straight through', async () => {
      const quoted = {
        results: [{ ...MOCK_FLIGHTS[0], price: 412, bookingUrl: 'https://example.test/fare' }],
        source: 'live' as const,
        quotedAt: '2027-05-01T10:00:00.000Z',
      };
      vi.spyOn(http, 'get').mockResolvedValue(quoted);

      expect(await flightService.searchFlights(FLIGHT_QUERY)).toEqual(quoted);
    });

    it('sends the search as query parameters', async () => {
      const get = vi
        .spyOn(http, 'get')
        .mockResolvedValue({ results: [], source: 'live', quotedAt: null });

      await flightService.searchFlights(FLIGHT_QUERY);

      expect(get).toHaveBeenCalledWith('/flights/search', {
        query: {
          from: 'JFK',
          to: 'DPS',
          departDate: '2027-05-20',
          returnDate: '2027-05-28',
          travellers: 2,
        },
      });
    });

    // A route the provider has never heard of is a real answer. Inventing five
    // fares to fill the space is the one thing this must never do.
    it('returns an empty live result rather than substituting samples', async () => {
      vi.spyOn(http, 'get').mockResolvedValue({
        results: [],
        source: 'live',
        quotedAt: '2027-05-01T10:00:00.000Z',
      });

      const found = await flightService.searchFlights(FLIGHT_QUERY);

      expect(found.results).toEqual([]);
      expect(found.source).toBe('live');
    });
  });

  describe('when it does not', () => {
    it('falls back to samples when no provider is configured', async () => {
      stubApiFailure(ERROR_CODES.PROVIDER_NOT_CONFIGURED);

      const found = await settle(flightService.searchFlights(FLIGHT_QUERY));

      expect(found.results).toHaveLength(MOCK_FLIGHTS.length);
      expect(found.source).toBe('sample');
      expect(found.quotedAt).toBeNull();
    });

    it('falls back the same way when the network is gone', async () => {
      stubApiFailure(ERROR_CODES.NETWORK);

      const found = await settle(flightService.searchFlights(FLIGHT_QUERY));

      expect(found.source).toBe('sample');
    });

    // The rule the whole provenance mechanism exists to enforce.
    it('never gives an invented fare somewhere to be booked', async () => {
      stubApiFailure(ERROR_CODES.PROVIDER_NOT_CONFIGURED);

      const found = await settle(flightService.searchFlights(FLIGHT_QUERY));

      expect(found.results.every((flight) => flight.bookingUrl === null)).toBe(true);
    });

    it('labels the samples with the requested route', async () => {
      stubApiFailure(ERROR_CODES.NETWORK);

      const found = await settle(
        flightService.searchFlights({ ...FLIGHT_QUERY, from: 'LHR', to: 'HND' }),
      );

      expect(found.results.every((flight) => flight.from === 'LHR' && flight.to === 'HND')).toBe(
        true,
      );
    });

    it('does not mutate the mock data', async () => {
      stubApiFailure(ERROR_CODES.NETWORK);

      await settle(flightService.searchFlights({ ...FLIGHT_QUERY, from: 'LHR', to: 'HND' }));

      expect(MOCK_FLIGHTS[0].from).toBe('JFK');
    });
  });
});

describe('hotelService', () => {
  it('passes quoted stays through', async () => {
    const quoted = {
      results: [{ ...MOCK_HOTELS[0], pricePerNight: 180, bookingUrl: 'https://example.test/stay' }],
      source: 'live' as const,
      quotedAt: '2027-05-01T10:00:00.000Z',
    };
    vi.spyOn(http, 'get').mockResolvedValue(quoted);

    expect(await hotelService.searchHotels(HOTEL_QUERY)).toEqual(quoted);
  });

  // Stays stay on the sample path longest: the provider gates hotel data
  // behind a separate approval, so an unconfigured hotel search is the
  // expected state for a while rather than a fault.
  it('falls back to labelled samples', async () => {
    stubApiFailure(ERROR_CODES.PROVIDER_NOT_CONFIGURED);

    const found = await settle(hotelService.searchHotels(HOTEL_QUERY));

    expect(found.results).toHaveLength(MOCK_HOTELS.length);
    expect(found.source).toBe('sample');
    expect(found.results.every((hotel) => hotel.bookingUrl === null)).toBe(true);
  });

  it('labels the samples with the searched destination', async () => {
    stubApiFailure(ERROR_CODES.NETWORK);

    const found = await settle(
      hotelService.searchHotels({ ...HOTEL_QUERY, destination: 'Seminyak' }),
    );

    expect(found.results.every((hotel) => hotel.location === 'Seminyak')).toBe(true);
  });

  it('does not mutate the mock data', async () => {
    stubApiFailure(ERROR_CODES.NETWORK);

    await settle(hotelService.searchHotels({ ...HOTEL_QUERY, destination: 'Seminyak' }));

    expect(MOCK_HOTELS[0].location).toBe('Ubud');
  });
});
