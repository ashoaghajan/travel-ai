import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../env';
import { hotelBookingUrl, searchHotels } from './hotels';

/**
 * Hotel listings.
 *
 * The rule under test is the one that makes this honest: these are real places
 * with real booking links and **no prices**, because no pricing provider is
 * reachable. A listing must never acquire a nightly rate here.
 */

const SEARCH = {
  destination: 'Dubai',
  checkIn: '2026-09-11',
  checkOut: '2026-09-14',
  guests: 2,
  limit: 10,
  marker: '758565',
};

const GEONAME = { lat: 25.2048, lon: 55.2708, name: 'Dubai' };

const PLACES = [
  { xid: 'W1', name: 'Sofitel Dubai Downtown', kinds: 'accomodations,other_hotels', rate: 3 },
  { xid: 'W2', name: 'Al Habtoor Polo Resort', kinds: 'accomodations,resorts', rate: 2 },
  { xid: 'W3', name: 'Rove Hostel', kinds: 'accomodations,hostels', rate: 1 },
  // Tagged as accommodation because a hotel is inside it. Not a stay.
  { xid: 'W4', name: 'Burj Khalifa', kinds: 'skyscrapers,architecture,accomodations', rate: 7 },
  // No name to show.
  { xid: 'W5', name: '   ', kinds: 'accomodations,other_hotels', rate: 3 },
  { xid: 'W6', name: 'No Id Hotel', kinds: 'accomodations,other_hotels', rate: 3 },
];

function stubProvider(places: unknown = PLACES, geoname: unknown = GEONAME) {
  return vi.fn(async (url: URL | string) =>
    String(url).includes('/geoname')
      ? new Response(JSON.stringify(geoname), { status: 200 })
      : new Response(JSON.stringify(places), { status: 200 }),
  );
}

beforeEach(() => {
  process.env.OPENTRIPMAP_API_KEY = 'test-key';
  resetEnvCache();
  vi.stubGlobal('fetch', stubProvider());
});

afterEach(() => {
  delete process.env.OPENTRIPMAP_API_KEY;
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe('searchHotels', () => {
  it('returns real named stays for the destination', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.map((h) => h.name)).toContain('Sofitel Dubai Downtown');
  });

  // The whole point of the `listing` state, and still the behaviour whenever
  // no pricing provider is configured. An invented rate next to a real booking
  // link is the one thing this must never produce.
  it('quotes no price when no pricing provider is configured', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.every((h) => h.pricePerNight === null)).toBe(true);
  });

  it('gives every stay somewhere to be booked', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.every((h) => h.bookingUrl?.includes('hotellook'))).toBe(true);
  });

  /*
   * `accomodations` alone is too broad — the provider hangs it on the Burj
   * Khalifa because there is a hotel inside. A skyscraper is not a stay.
   */
  it('leaves out landmarks that merely contain a hotel', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.map((h) => h.name)).not.toContain('Burj Khalifa');
  });

  it('leaves out places with no name to show', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.every((h) => h.name.trim().length > 0)).toBe(true);
  });

  it('names the kind of stay each one is', async () => {
    const found = await searchHotels(SEARCH);
    const byName = Object.fromEntries(found.map((h) => [h.name, h.category]));

    expect(byName['Al Habtoor Polo Resort']).toBe('Resort');
    expect(byName['Rove Hostel']).toBe('Hostel');
    expect(byName['Sofitel Dubai Downtown']).toBe('Hotel');
  });

  it('puts the most notable first', async () => {
    const found = await searchHotels(SEARCH);

    expect(found[0].name).toBe('Sofitel Dubai Downtown');
  });

  it('respects the limit', async () => {
    expect(await searchHotels({ ...SEARCH, limit: 2 })).toHaveLength(2);
  });

  it('reports no rating rather than a bad one', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.every((h) => h.rating === 0 && h.reviews === 0)).toBe(true);
  });

  // A destination the geocoder cannot place is an empty answer, not a crash.
  it('returns nothing for a destination it cannot locate', async () => {
    vi.stubGlobal('fetch', stubProvider(PLACES, { status: 'NOT_FOUND' }));

    expect(await searchHotels(SEARCH)).toEqual([]);
  });

  it('survives the radius search answering with an error object', async () => {
    vi.stubGlobal('fetch', stubProvider({ error: 'nope' }));

    expect(await searchHotels(SEARCH)).toEqual([]);
  });

  it('refuses to run with no API key configured', async () => {
    delete process.env.OPENTRIPMAP_API_KEY;
    resetEnvCache();

    await expect(searchHotels(SEARCH)).rejects.toMatchObject({ status: 503 });
  });
});

/**
 * Which source answers, and when.
 *
 * The rule: LiteAPI when it has anything for the destination, OpenTripMap
 * whenever it does not. A reader must never lose their hotel list because a
 * pricing provider was unreachable.
 */
describe('searchHotels with a pricing provider', () => {
  const STAYS = {
    data: [
      {
        id: 'lp1',
        name: 'Grand Hotel Yerevan',
        address: 'Abovyan St 10',
        rating: 8.6,
        reviewCount: 1204,
        main_photo: 'https://img.example/grand.jpg',
      },
    ],
  };

  /** Three nights in `SEARCH`, so 300 is 100 a night. */
  const RATES = { data: [{ hotelId: 'lp1', price: 300 }] };

  /** OpenTripMap for the geocode, LiteAPI for everything after it. */
  function stubBoth(stays: unknown = STAYS) {
    return vi.fn(async (url: URL | string) => {
      const href = String(url);

      if (href.includes('/geoname')) return new Response(JSON.stringify(GEONAME), { status: 200 });
      if (href.includes('/data/hotels')) return new Response(JSON.stringify(stays), { status: 200 });
      if (href.includes('min-rates')) return new Response(JSON.stringify(RATES), { status: 200 });

      return new Response(JSON.stringify(PLACES), { status: 200 });
    });
  }

  beforeEach(() => {
    process.env.LITEAPI_KEY = 'sand-test-key';
    resetEnvCache();
    vi.stubGlobal('fetch', stubBoth());
  });

  afterEach(() => {
    delete process.env.LITEAPI_KEY;
    resetEnvCache();
  });

  it('prefers the priced catalogue over the directory', async () => {
    const found = await searchHotels(SEARCH);

    expect(found.map((h) => h.name)).toEqual(['Grand Hotel Yerevan']);
    expect(found[0].pricePerNight).toBe(100);
  });

  it('shows the rating and photo the directory could never supply', async () => {
    const [first] = await searchHotels(SEARCH);

    expect(first.rating).toBe(8.6);
    expect(first.reviews).toBe(1204);
    expect(first.image).toBe('https://img.example/grand.jpg');
  });

  // Still a Hotellook link: LiteAPI prices the stay, the partner sells it.
  it('keeps sending the reader to the partner to book', async () => {
    const [first] = await searchHotels(SEARCH);

    expect(first.bookingUrl).toContain('hotellook');
  });

  it('falls back to unpriced listings when the catalogue has nothing here', async () => {
    vi.stubGlobal('fetch', stubBoth({ data: [] }));

    const found = await searchHotels(SEARCH);

    expect(found.map((h) => h.name)).toContain('Sofitel Dubai Downtown');
    expect(found.every((h) => h.pricePerNight === null)).toBe(true);
  });

  it('falls back rather than failing when the provider is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const href = String(url);

        if (href.includes('/geoname')) return new Response(JSON.stringify(GEONAME), { status: 200 });
        if (href.includes('liteapi')) throw new Error('ECONNREFUSED');

        return new Response(JSON.stringify(PLACES), { status: 200 });
      }),
    );

    const found = await searchHotels(SEARCH);

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((h) => h.pricePerNight === null)).toBe(true);
  });
});

describe('hotelBookingUrl', () => {
  it('searches the partner for that property on those dates', () => {
    const url = new URL(
      hotelBookingUrl('Sofitel Dubai Downtown', 'Dubai', '2026-09-11', '2026-09-14', 2, null),
    );

    expect(url.hostname).toBe('search.hotellook.com');
    expect(url.searchParams.get('query')).toBe('Sofitel Dubai Downtown Dubai');
    expect(url.searchParams.get('checkIn')).toBe('2026-09-11');
    expect(url.searchParams.get('checkOut')).toBe('2026-09-14');
    expect(url.searchParams.get('adults')).toBe('2');
  });

  // The same marker that attributes flight commission attributes this.
  it('carries the affiliate marker when there is one', () => {
    const url = new URL(hotelBookingUrl('X', 'Dubai', '2026-09-11', '2026-09-14', 2, '758565'));

    expect(url.searchParams.get('marker')).toBe('758565');
  });

  it('still builds a usable link without a marker', () => {
    const url = new URL(hotelBookingUrl('X', 'Dubai', '2026-09-11', '2026-09-14', 2, null));

    expect(url.searchParams.has('marker')).toBe(false);
    expect(url.hostname).toBe('search.hotellook.com');
  });
});
