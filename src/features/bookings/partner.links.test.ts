import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookingContext, FlightSearchQuery, Partner } from '../../types/travel.types';
import { MOCK_PARTNERS } from '../../mock/partners';
import {
  buildActivityUrl,
  buildPartnerUrl,
  describeBookingContext,
  toBookingContext,
} from './partner.links';

function partner(id: string): Partner {
  const found = MOCK_PARTNERS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No partner ${id}`);
  return found;
}

const EXPEDIA = partner('partner-expedia');
const TRIP = partner('partner-trip');
const BOOKING = partner('partner-booking');
const GETYOURGUIDE = partner('partner-getyourguide');

function context(overrides: Partial<BookingContext> = {}): BookingContext {
  return {
    tripType: 'round-trip',
    originCode: 'JFK',
    destinationCode: 'DPS',
    destinationCity: 'Denpasar Bali',
    destinationCountry: 'Indonesia',
    departDate: '2026-09-20',
    returnDate: '2026-09-28',
    travellers: 2,
    ...overrides,
  };
}

/** Nothing known — a first visit with no saved search. */
const BLANK = context({
  originCode: null,
  destinationCode: null,
  destinationCity: null,
  departDate: null,
  returnDate: null,
  travellers: 1,
});

/** The decoded query string, so assertions read like the partner's own form. */
function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('toBookingContext', () => {
  const query: FlightSearchQuery = {
    tripType: 'round-trip',
    from: 'JFK',
    to: 'DPS',
    departDate: '2026-09-20',
    returnDate: '2026-09-28',
    travellers: 2,
  };

  it('carries the saved search across, resolving the destination city', () => {
    expect(toBookingContext(query)).toEqual({
      tripType: 'round-trip',
      originCode: 'JFK',
      destinationCode: 'DPS',
      destinationCity: 'Denpasar Bali',
      // A flight search records no country; only a trip supplies one.
      destinationCountry: null,
      departDate: '2026-09-20',
      returnDate: '2026-09-28',
      travellers: 2,
    });
  });

  it('leaves the city null for an airport we do not list', () => {
    expect(toBookingContext({ ...query, to: 'ZZZ' }).destinationCity).toBeNull();
  });

  it('knows nothing on a first visit', () => {
    const empty = toBookingContext(null);

    expect(empty.originCode).toBeNull();
    expect(empty.departDate).toBeNull();
    expect(empty.travellers).toBe(1);
  });
});

describe('describeBookingContext', () => {
  it('summarises the route, dates and party', () => {
    expect(describeBookingContext(context())).toBe('JFK → DPS · Sep 20 - Sep 28 · 2 travellers');
  });

  it('drops the return date from a one-way summary and counts one traveller', () => {
    expect(describeBookingContext(context({ returnDate: null, travellers: 1 }))).toBe(
      'JFK → DPS · Sep 20 · 1 traveller',
    );
  });

  it('names the city when there is no airport pair to show', () => {
    expect(describeBookingContext(context({ originCode: null, destinationCode: null }))).toBe(
      'Denpasar Bali · Sep 20 - Sep 28 · 2 travellers',
    );
  });

  it('says nothing when nothing is known', () => {
    expect(describeBookingContext(BLANK)).toBeNull();
  });
});

describe('buildPartnerUrl — Expedia flights', () => {
  it('builds a round trip with both legs', () => {
    const url = buildPartnerUrl(EXPEDIA, 'flights', context());

    expect(url.startsWith('https://www.expedia.com/Flights-Search?')).toBe(true);
    expect(params(url)).toEqual({
      leg1: 'from:JFK,to:DPS,departure:9/20/2026TANYT',
      leg2: 'from:DPS,to:JFK,departure:9/28/2026TANYT',
      trip: 'roundtrip',
      passengers: 'adults:2',
      mode: 'search',
    });
  });

  it("encodes the separators Expedia's leg syntax uses", () => {
    const url = buildPartnerUrl(EXPEDIA, 'flights', context());

    expect(url).toContain('leg1=from%3AJFK%2Cto%3ADPS%2Cdeparture%3A9%2F20%2F2026TANYT');
  });

  it('omits the return leg on a one-way', () => {
    const url = buildPartnerUrl(EXPEDIA, 'flights', context({ tripType: 'one-way' }));

    expect(params(url).leg2).toBeUndefined();
    expect(params(url).trip).toBe('oneway');
  });

  // The search form carries one leg and says so; inventing a return would book
  // the reader onto a flight they never asked for.
  it('treats a multi-city search as a one-way', () => {
    const url = buildPartnerUrl(EXPEDIA, 'flights', context({ tripType: 'multi-city' }));

    expect(params(url).leg2).toBeUndefined();
    expect(params(url).trip).toBe('oneway');
  });

  it('falls back to the home page without a route', () => {
    expect(buildPartnerUrl(EXPEDIA, 'flights', BLANK)).toBe('https://www.expedia.com/');
  });

  // Expedia is the one partner needing a date reformat, so it is the one that
  // has to survive a date it cannot parse.
  it('passes a malformed date through rather than emitting NaN', () => {
    const url = buildPartnerUrl(EXPEDIA, 'flights', context({ departDate: 'soon' }));

    expect(params(url).leg1).toBe('from:JFK,to:DPS,departure:soonTANYT');
  });
});

describe('buildPartnerUrl — hotels', () => {
  it('builds an Expedia stay from the flight dates', () => {
    const url = buildPartnerUrl(EXPEDIA, 'hotels', context());

    expect(url.startsWith('https://www.expedia.com/Hotel-Search?')).toBe(true);
    expect(params(url)).toEqual({
      destination: 'Denpasar Bali',
      startDate: '2026-09-20',
      endDate: '2026-09-28',
      adults: '2',
    });
  });

  it('builds a Booking.com search', () => {
    const url = buildPartnerUrl(BOOKING, 'hotels', context());

    expect(url.startsWith('https://www.booking.com/searchresults.html?')).toBe(true);
    expect(params(url)).toEqual({
      ss: 'Denpasar Bali',
      checkin: '2026-09-20',
      checkout: '2026-09-28',
      group_adults: '2',
      group_children: '0',
      no_rooms: '1',
    });
  });

  it('needs both ends of the stay', () => {
    expect(buildPartnerUrl(BOOKING, 'hotels', context({ returnDate: null }))).toBe(
      'https://www.booking.com/',
    );
  });

  // Trip.com's hotel list keys off an internal numeric city id we cannot resolve.
  it('sends Trip.com hotels to the home page rather than guessing', () => {
    expect(buildPartnerUrl(TRIP, 'hotels', context())).toBe('https://us.trip.com/');
  });
});

describe('buildPartnerUrl — Trip.com flights', () => {
  it('builds a round trip with lower-case airport codes', () => {
    const url = buildPartnerUrl(TRIP, 'flights', context());

    expect(url.startsWith('https://us.trip.com/flights/showfarefirst?')).toBe(true);
    expect(params(url)).toEqual({
      dcity: 'jfk',
      acity: 'dps',
      ddate: '2026-09-20',
      rdate: '2026-09-28',
      triptype: 'rt',
      class: 'y',
      quantity: '2',
      locale: 'en-US',
      curr: 'USD',
    });
  });

  it('drops the return date on a one-way', () => {
    const url = buildPartnerUrl(TRIP, 'flights', context({ tripType: 'one-way' }));

    expect(params(url).rdate).toBeUndefined();
    expect(params(url).triptype).toBe('ow');
  });
});

describe('buildPartnerUrl — GetYourGuide activities', () => {
  it('searches the destination city', () => {
    const url = buildPartnerUrl(GETYOURGUIDE, 'activities', context());

    expect(url.startsWith('https://www.getyourguide.com/s/?')).toBe(true);
    expect(params(url)).toEqual({ q: 'Denpasar Bali' });
  });

  it('falls back without a city', () => {
    expect(buildPartnerUrl(GETYOURGUIDE, 'activities', BLANK)).toBe(
      'https://www.getyourguide.com/',
    );
  });
});

describe('buildActivityUrl', () => {
  it('searches for the attraction by name, narrowed by its city', () => {
    const url = buildActivityUrl('Cascade Complex', 'Yerevan');

    expect(url.startsWith('https://www.getyourguide.com/s/?')).toBe(true);
    // The city matters: "Cascade" alone finds the wrong ones.
    expect(params(url)).toEqual({ q: 'Cascade Complex Yerevan' });
  });

  it('searches by name alone when the city is unknown', () => {
    expect(params(buildActivityUrl('Cascade Complex', null))).toEqual({ q: 'Cascade Complex' });
  });

  it('trims what it is given', () => {
    expect(params(buildActivityUrl('  Cascade  ', '  Yerevan  '))).toEqual({
      q: 'Cascade Yerevan',
    });
  });
});

describe('buildPartnerUrl — categories a partner does not cover', () => {
  it('sends Expedia activities to the home page', () => {
    expect(buildPartnerUrl(EXPEDIA, 'activities', context())).toBe('https://www.expedia.com/');
  });

  it('sends GetYourGuide flights to the home page', () => {
    expect(buildPartnerUrl(GETYOURGUIDE, 'flights', context())).toBe(
      'https://www.getyourguide.com/',
    );
  });
});

describe('affiliate tracking', () => {
  it('is absent while no id is configured', () => {
    expect(buildPartnerUrl(BOOKING, 'hotels', context())).not.toContain('aid=');
  });

  it('is appended to a search when the id is set', () => {
    vi.stubEnv('VITE_BOOKING_AFFILIATE_ID', '1234567');

    expect(params(buildPartnerUrl(BOOKING, 'hotels', context())).aid).toBe('1234567');
  });

  it('is appended to the home page fallback too', () => {
    vi.stubEnv('VITE_EXPEDIA_AFFILIATE_ID', 'aff-9');

    expect(buildPartnerUrl(EXPEDIA, 'flights', BLANK)).toBe(
      'https://www.expedia.com/?affcid=aff-9',
    );
  });

  it('ignores an id that is only whitespace', () => {
    vi.stubEnv('VITE_TRIP_AFFILIATE_ID', '   ');

    expect(buildPartnerUrl(TRIP, 'flights', context())).not.toContain('Allianceid');
  });

  it('leaves the rest of the query intact', () => {
    vi.stubEnv('VITE_EXPEDIA_AFFILIATE_ID', 'aff-9');
    const url = buildPartnerUrl(EXPEDIA, 'flights', context());

    expect(params(url).leg1).toBe('from:JFK,to:DPS,departure:9/20/2026TANYT');
    expect(params(url).affcid).toBe('aff-9');
  });
});
