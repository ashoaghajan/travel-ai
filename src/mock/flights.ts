import type { Flight } from '../types/travel.types';
import { formatDuration } from '../utils/duration';
import { DEFAULT_DESTINATION, DEFAULT_ORIGIN } from './airports';

/**
 * Mock flight results — DESIGN_SPEC Screen 4.
 *
 * Authored in the order the "Recommended" sort shows them. The display
 * `duration` is derived from `durationMinutes` so the two can never disagree.
 */
type FlightSeed = Omit<
  Flight,
  'duration' | 'from' | 'to' | 'bookingUrl' | 'departureDate' | 'returnDate'
>;

const FLIGHT_SEEDS: FlightSeed[] = [
  {
    id: 'flight-emirates-ek202',
    airline: 'Emirates',
    departureTime: '11:30 PM',
    arrivalTime: '8:15 AM',
    durationMinutes: 1725,
    stops: 1,
    price: 1124,
  },
  {
    id: 'flight-qatar-qr704',
    airline: 'Qatar Airways',
    departureTime: '9:05 PM',
    arrivalTime: '6:40 AM',
    durationMinutes: 1595,
    stops: 1,
    price: 1186,
  },
  {
    id: 'flight-singapore-sq25',
    airline: 'Singapore Airlines',
    departureTime: '9:40 AM',
    arrivalTime: '11:55 PM',
    durationMinutes: 1455,
    stops: 1,
    price: 1342,
  },
  {
    id: 'flight-emirates-ek204',
    airline: 'Emirates',
    departureTime: '2:20 PM',
    arrivalTime: '5:05 AM',
    durationMinutes: 1845,
    stops: 2,
    price: 986,
  },
  {
    id: 'flight-singapore-sq23',
    airline: 'Singapore Airlines',
    departureTime: '6:50 PM',
    arrivalTime: '4:30 AM',
    durationMinutes: 1360,
    stops: 1,
    price: 1498,
  },
];

export const MOCK_FLIGHTS: Flight[] = FLIGHT_SEEDS.map((seed) => ({
  ...seed,
  from: DEFAULT_ORIGIN,
  to: DEFAULT_DESTINATION,
  duration: formatDuration(seed.durationMinutes),
  /*
   * Never a link. These prices are invented, so sending someone to a real
   * checkout on the strength of one would be a lie with a purchase at the end
   * of it. The screens offer a route-level partner search instead.
   */
  bookingUrl: null,
  // Samples belong to no particular day; the screens fall back to the dates
  // the search itself was made for.
  departureDate: null,
  returnDate: null,
}));
