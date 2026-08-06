import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingUrl, toFlight, toFlights } from './flights.mapper';
import type { PriceRow } from './flights.mapper';
import { resetAirlineTable } from './airlines';

/**
 * The translation layer between the provider's dialect and ours.
 *
 * Worth testing closely because two of its jobs are quietly easy to get wrong:
 * the outbound link is relative and useless until it is not, and the times are
 * local to airports that are not in the server's timezone.
 */

/** A round trip JFK → DPS, in the shape the provider sends. */
function row(overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    origin: 'JFK',
    destination: 'DPS',
    origin_airport: 'JFK',
    destination_airport: 'DPS',
    price: 412,
    airline: 'SU',
    flight_number: 101,
    departure_at: '2027-05-20T23:30:00-04:00',
    return_at: '2027-05-28T08:15:00+08:00',
    transfers: 1,
    duration: 2400,
    duration_to: 1725,
    duration_back: 1680,
    link: '/search/JFK2005DPS1?t=abc',
    currency: 'usd',
    ...overrides,
  };
}

beforeEach(() => {
  resetAirlineTable();
  // The airline table is a nicety; every test here stubs it away so a lookup
  // failure cannot make an unrelated assertion flake.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAirlineTable();
});

describe('bookingUrl', () => {
  // The provider's `link` is a path. Shipping it unchanged would put
  // "/search/…" in an href and send the reader to our own 404.
  it('roots a relative link at the seller', () => {
    expect(bookingUrl('/search/JFK2005DPS1?t=abc', null)).toBe(
      'https://www.aviasales.com/search/JFK2005DPS1?t=abc',
    );
  });

  it('attaches the affiliate marker, which is what earns the commission', () => {
    const url = new URL(bookingUrl('/search/x', '12345') ?? '');

    expect(url.searchParams.get('marker')).toBe('12345');
  });

  it('leaves the link unattributed when this deployment has no marker', () => {
    const url = new URL(bookingUrl('/search/x', null) ?? '');

    expect(url.searchParams.has('marker')).toBe(false);
  });

  it('keeps the query the provider already put on the link', () => {
    const url = new URL(bookingUrl('/search/x?t=abc&currency=usd', '12345') ?? '');

    expect(url.searchParams.get('t')).toBe('abc');
    expect(url.searchParams.get('currency')).toBe('usd');
  });

  // A card with no link renders without a button, which is the point.
  it('is null when the row carried no link', () => {
    expect(bookingUrl(undefined, '12345')).toBeNull();
    expect(bookingUrl('', '12345')).toBeNull();
  });
});

describe('toFlight', () => {
  it('maps the fields the cards read', async () => {
    const flight = await toFlight(row(), '12345');

    expect(flight).toMatchObject({
      from: 'JFK',
      to: 'DPS',
      price: 412,
      stops: 1,
      durationMinutes: 1725,
      duration: '28h 45m',
    });
  });

  /*
   * The provider puts the metropolitan code in `origin` and the airport in
   * `origin_airport`, so a JFK→LHR search answers "NYC→LON" unless the airport
   * wins — which contradicts both the header and the airports the reader chose.
   */
  it('shows the airport rather than the city it belongs to', async () => {
    const flight = await toFlight(
      row({
        origin: 'NYC',
        destination: 'LON',
        origin_airport: 'JFK',
        destination_airport: 'LHR',
      }),
      null,
    );

    expect(flight.from).toBe('JFK');
    expect(flight.to).toBe('LHR');
  });

  it('falls back to the city code when no airport is given', async () => {
    const flight = await toFlight(
      row({ origin: 'NYC', destination: 'LON', origin_airport: undefined, destination_airport: undefined }),
      null,
    );

    expect(flight.from).toBe('NYC');
    expect(flight.to).toBe('LON');
  });

  // `duration` counts the return leg too — using it would show a 28-hour
  // outbound as 40 hours.
  it('measures the outbound leg, not the round trip', async () => {
    const flight = await toFlight(row({ duration: 2400, duration_to: 1725 }), null);

    expect(flight.durationMinutes).toBe(1725);
  });

  it('falls back to the round-trip duration when there is no leg figure', async () => {
    const flight = await toFlight(row({ duration_to: undefined, duration: 600 }), null);

    expect(flight.duration).toBe('10h');
  });

  /*
   * The reason `offsetZone` exists. `departure_at` is local to the origin
   * airport and carries its offset; formatting in the server's zone would
   * shift every departure by however far the server happens to be from JFK.
   */
  it('shows the departure in the airport\'s own time, not the server\'s', async () => {
    const flight = await toFlight(row({ departure_at: '2027-05-20T23:30:00-04:00' }), null);

    expect(flight.departureTime).toBe('11:30 PM');
  });

  it('derives the arrival from the departure plus time in the air', async () => {
    // 11:30 PM + 8h 45m, still in the origin's offset.
    const flight = await toFlight(
      row({ departure_at: '2027-05-20T23:30:00-04:00', duration_to: 525 }),
      null,
    );

    expect(flight.arrivalTime).toBe('8:15 AM');
  });

  /*
   * The day matters as much as the time now: fares arrive from a month-wide
   * search, so most of them are not on the day the reader asked for and the
   * card has to be able to say which day it is.
   */
  it('carries the day each fare departs', async () => {
    const flight = await toFlight(row({ departure_at: '2027-05-17T23:30:00-04:00' }), null);

    expect(flight.departureDate).toBe('2027-05-17');
  });

  // The local date, not the UTC one. 11:30 PM in New York is already the next
  // day in UTC, and shifting it would put the fare on the wrong date.
  it('reads the day in the airport\'s own offset', async () => {
    const flight = await toFlight(row({ departure_at: '2027-05-20T23:30:00-04:00' }), null);

    expect(flight.departureDate).toBe('2027-05-20');
  });

  it('has no return date for a one-way', async () => {
    const flight = await toFlight(row({ return_at: undefined }), null);

    expect(flight.returnDate).toBeNull();
  });

  it('carries the flight home, which the price also buys', async () => {
    const flight = await toFlight(row({ return_transfers: 0 }), null);

    expect(flight.returnLeg).toEqual({
      // 08:15 local to the +08:00 airport it leaves from, not the server's zone.
      departureTime: '8:15 AM',
      arrivalTime: '12:15 PM',
      date: '2027-05-28',
      duration: '28h',
      durationMinutes: 1680,
      stops: 0,
    });
  });

  it('keeps the two legs’ durations apart', async () => {
    const flight = await toFlight(row(), null);

    // `duration` is the outbound only; the round-trip total would say 40h.
    expect(flight.duration).toBe('28h 45m');
    expect(flight.returnLeg?.duration).toBe('28h');
  });

  it('counts the return’s own stops, not the outbound’s', async () => {
    const flight = await toFlight(row({ transfers: 1, return_transfers: 2 }), null);

    expect(flight.stops).toBe(1);
    expect(flight.returnLeg?.stops).toBe(2);
  });

  it('has no return leg on a one-way, which is what marks it as one', async () => {
    const flight = await toFlight(row({ return_at: undefined }), null);

    expect(flight.returnLeg).toBeUndefined();
  });

  it('still shows the return when its duration is missing', async () => {
    const flight = await toFlight(row({ duration_back: undefined }), null);

    // The day it leaves is the useful part; the rest says nothing rather than
    // guessing.
    expect(flight.returnLeg?.date).toBe('2027-05-28');
    expect(flight.returnLeg?.duration).toBe('');
    expect(flight.returnLeg?.arrivalTime).toBe('');
  });

  it('survives a departure it cannot parse', async () => {
    const flight = await toFlight(row({ departure_at: 'not a date' }), null);

    expect(flight.departureTime).toBe('');
    expect(flight.arrivalTime).toBe('');
  });

  it('gives each fare an id that survives a re-sort', async () => {
    const first = await toFlight(row(), null);
    const same = await toFlight(row(), null);
    const other = await toFlight(row({ flight_number: 102 }), null);

    expect(first.id).toBe(same.id);
    expect(first.id).not.toBe(other.id);
  });

  it('carries the booking link through', async () => {
    const flight = await toFlight(row(), '12345');

    expect(flight.bookingUrl).toContain('aviasales.com/search/JFK2005DPS1');
    expect(flight.bookingUrl).toContain('marker=12345');
  });

  it('leaves bookingUrl null when the provider gave none', async () => {
    const flight = await toFlight(row({ link: undefined }), '12345');

    expect(flight.bookingUrl).toBeNull();
  });

  // The airline table is best-effort; a fetch failure must not fail a search.
  it('falls back to the IATA code when no airline name is known', async () => {
    const flight = await toFlight(row({ airline: 'SU' }), null);

    expect(flight.airline).toBe('SU');
  });

  it('uses the airline name when the table has one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ code: 'SU', name: 'Aeroflot' }]), { status: 200 }),
      ),
    );
    resetAirlineTable();

    const flight = await toFlight(row({ airline: 'SU' }), null);

    expect(flight.airline).toBe('Aeroflot');
  });

  it('tolerates a row with almost nothing on it', async () => {
    const flight = await toFlight({}, null);

    expect(flight.price).toBe(0);
    expect(flight.stops).toBe(0);
    expect(flight.bookingUrl).toBeNull();
  });
});

describe('toFlights', () => {
  it('maps a list, and one airline lookup serves all of it', async () => {
    const flights = await toFlights([row(), row({ flight_number: 102 })], null);

    expect(flights).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers an empty list with an empty list', async () => {
    expect(await toFlights([], null)).toEqual([]);
  });
});
