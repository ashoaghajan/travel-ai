import type { Flight, FlightReturnLeg } from '@ai-travel/shared';
import { airlineName } from './airlines';

/**
 * Provider row → `Flight`.
 *
 * Pure but for the airline-name lookup. Everything the screens show is derived
 * here, so the SPA never learns the provider's field names and swapping
 * providers later touches this file and nothing above it.
 */

/** One row of `aviasales/v3/prices_for_dates`. */
export type PriceRow = {
  origin?: string;
  destination?: string;
  origin_airport?: string;
  destination_airport?: string;
  price?: number;
  airline?: string;
  flight_number?: number | string;
  departure_at?: string;
  return_at?: string;
  transfers?: number;
  return_transfers?: number;
  /** Total round-trip minutes. */
  duration?: number;
  /** Outbound minutes — the leg these cards describe. */
  duration_to?: number;
  duration_back?: number;
  /** Relative path; absolute only once prefixed. See `bookingUrl`. */
  link?: string;
  currency?: string;
};

/** Where the provider's relative `link` values are rooted. */
const AVIASALES_ORIGIN = 'https://www.aviasales.com';

/** "28h 45m", matching the client's `formatDuration` exactly. */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** "11:30 PM" in the airport's own local time, which is what the row carries. */
function displayTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  // `departure_at` is local to the origin airport with an offset attached.
  // Reading the offset back out keeps "11:30 PM" meaning 11:30 PM *there* —
  // formatting in the server's zone would silently shift every flight.
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: offsetZone(iso),
  }).format(at);
}

/**
 * The row's own UTC offset as an IANA-acceptable zone.
 *
 * `Intl` will not take "+07:00", but `Etc/GMT-7` is the same thing with the
 * sign inverted — a POSIX quirk this has to honour to come out right.
 */
function offsetZone(iso: string): string {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (!match) return 'UTC';

  const [, sign, hours, minutes] = match;
  const whole = Number(hours);

  // `Etc/GMT±N` has no half-hour members; fall back rather than lie.
  if (minutes !== '00' || whole > 14) return 'UTC';
  if (whole === 0) return 'UTC';

  return `Etc/GMT${sign === '+' ? '-' : '+'}${whole}`;
}

/** Departure plus time in the air, as a display time in the same zone. */
function arrivalTime(departureAt: string, minutes: number): string {
  const departure = new Date(departureAt);
  if (Number.isNaN(departure.getTime()) || minutes <= 0) return '';

  const arrival = new Date(departure.getTime() + minutes * 60_000);

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: offsetZone(departureAt),
  }).format(arrival);
}

/**
 * The outbound booking link.
 *
 * Two things happen here and nowhere else: the provider's relative `link`
 * becomes absolute, and the affiliate marker is attached. Returns null when
 * the row carried no link — the card then renders without an action rather
 * than with one that goes nowhere.
 */
export function bookingUrl(link: string | undefined, affiliateMarker: string | null): string | null {
  if (!link) return null;

  let url: URL;

  try {
    // Absolute links pass through unchanged; relative ones root at Aviasales.
    url = new URL(link, AVIASALES_ORIGIN);
  } catch {
    return null;
  }

  // The marker is how the commission is attributed — the `Referer` is not,
  // which is why `rel="noreferrer"` on the anchor costs nothing.
  if (affiliateMarker) url.searchParams.set('marker', affiliateMarker);

  return url.toString();
}

/** The calendar day out of an ISO instant, without shifting it into UTC. */
function isoDate(iso: string | undefined): string | null {
  if (!iso) return null;

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1] : null;
}

/**
 * A stable id.
 *
 * The provider sends no identifier, and React needs one that survives a
 * re-sort. Route, carrier, number and departure together identify a fare.
 */
function flightId(row: PriceRow): string {
  return [
    row.origin ?? '',
    row.destination ?? '',
    row.airline ?? '',
    row.flight_number ?? '',
    row.departure_at ?? '',
  ]
    .join('-')
    .toLowerCase();
}

/**
 * The flight home, when the row quotes one.
 *
 * A round-trip price buys two flights, and the row has always carried the
 * second — `return_at`, `duration_back`, `return_transfers` — while only the
 * outbound reached the screens. Returns undefined for a one-way row, which is
 * what makes `returnLeg`'s presence the test for "is this a round trip".
 *
 * `duration_back` alone can be missing on a row that does have a return date.
 * The leg is still worth showing: the day it leaves is the useful part, and
 * `arrivalTime` already answers "" rather than guessing when it cannot tell.
 */
function returnLeg(row: PriceRow): FlightReturnLeg | undefined {
  const returnAt = row.return_at;
  if (!returnAt) return undefined;

  const minutes = row.duration_back ?? 0;

  return {
    departureTime: displayTime(returnAt),
    arrivalTime: arrivalTime(returnAt, minutes),
    date: isoDate(returnAt),
    duration: minutes > 0 ? formatDuration(minutes) : '',
    durationMinutes: minutes,
    stops: row.return_transfers ?? 0,
  };
}

export async function toFlight(row: PriceRow, affiliateMarker: string | null): Promise<Flight> {
  const departureAt = row.departure_at ?? '';
  // `duration_to` is the outbound leg; `duration` counts the return as well
  // and would show a nine-hour hop as twenty.
  const minutes = row.duration_to ?? row.duration ?? 0;

  return {
    id: flightId(row),
    airline: await airlineName(row.airline ?? ''),
    /*
     * Airport before city. The provider fills `origin` with the metropolitan
     * code and `origin_airport` with the real one — a JFK→LHR search comes
     * back saying NYC→LON, which does not match the header the reader is
     * looking at or the airports they chose.
     */
    from: row.origin_airport ?? row.origin ?? '',
    to: row.destination_airport ?? row.destination ?? '',
    departureTime: displayTime(departureAt),
    arrivalTime: arrivalTime(departureAt, minutes),
    departureDate: isoDate(departureAt),
    returnDate: isoDate(row.return_at),
    returnLeg: returnLeg(row),
    duration: formatDuration(minutes),
    stops: row.transfers ?? 0,
    price: Math.round(row.price ?? 0),
    durationMinutes: minutes,
    bookingUrl: bookingUrl(row.link, affiliateMarker),
  };
}

export function toFlights(rows: PriceRow[], affiliateMarker: string | null): Promise<Flight[]> {
  return Promise.all(rows.map((row) => toFlight(row, affiliateMarker)));
}
