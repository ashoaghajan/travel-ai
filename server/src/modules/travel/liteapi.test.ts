import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../env';
import { isLiteApiConfigured, nightsBetween, roomsFor, searchStays } from './liteapi';

/**
 * The LiteAPI pricing client.
 *
 * Two rules carry most of the weight. A room is priced per *room*, not per
 * head — see `roomsFor` — and a provider that fails must cost the reader their
 * prices and nothing else, which is why every failure below asserts an empty
 * list rather than a rejection.
 */

const SEARCH = {
  lat: 40.1792,
  lon: 44.4991,
  checkIn: '2026-09-02',
  checkOut: '2026-09-06', // four nights
  guests: 2,
  limit: 10,
};

const HOTELS = {
  data: [
    {
      id: 'lp1a2b',
      name: 'Grand Hotel Yerevan',
      address: 'Abovyan St 10',
      city: 'Yerevan',
      rating: 8.6,
      reviewCount: 1204,
      main_photo: 'https://img.example/grand.jpg',
    },
    {
      id: 'lp3c4d',
      name: 'Tufenkian Historic',
      address: 'Hanrapetutyan St 48',
      city: 'Yerevan',
      rating: 8.1,
      reviewCount: 640,
      main_photo: 'https://img.example/tufenkian.jpg',
    },
  ],
};

/** 480 over four nights is 120 a night; 320 is 80. */
const MIN_RATES = {
  data: [
    { hotelId: 'lp1a2b', price: 480 },
    { hotelId: 'lp3c4d', price: 320 },
  ],
};

type Overrides = { hotels?: unknown; rates?: unknown; hotelsStatus?: number };

function stubLiteApi(overrides: Overrides = {}) {
  // `init` is declared even though the happy path ignores it, so that
  // `mock.calls` stays a two-element tuple and the assertions below can reach
  // the request body and headers.
  return vi.fn(async (url: URL | string, init?: RequestInit) => {
    void init;
    const href = String(url);

    if (href.includes('/data/hotels')) {
      return new Response(JSON.stringify(overrides.hotels ?? HOTELS), {
        status: overrides.hotelsStatus ?? 200,
      });
    }

    return new Response(JSON.stringify(overrides.rates ?? MIN_RATES), { status: 200 });
  });
}

/** The JSON body of the min-rates call, for asserting on occupancy. */
function ratesBody(fetchMock: ReturnType<typeof stubLiteApi>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('min-rates'));

  return JSON.parse((call?.[1]?.body as string | undefined) ?? '{}');
}

beforeEach(() => {
  process.env.LITEAPI_KEY = 'sand-test-key';
  resetEnvCache();
  vi.stubGlobal('fetch', stubLiteApi());
});

afterEach(() => {
  delete process.env.LITEAPI_KEY;
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe('roomsFor', () => {
  /*
   * The arithmetic that separates a room rate from an airfare. A fare is per
   * passenger; a room is per room, and two travellers are one double. Getting
   * this wrong doubles the cost of every couple's trip.
   */
  it('puts two travellers in one room', () => {
    expect(roomsFor(2)).toEqual({ rooms: 1, adultsPerRoom: 2 });
  });

  it('gives a lone traveller a single room', () => {
    expect(roomsFor(1)).toEqual({ rooms: 1, adultsPerRoom: 1 });
  });

  it('rounds an odd party up to a whole room', () => {
    expect(roomsFor(3)).toEqual({ rooms: 2, adultsPerRoom: 2 });
    expect(roomsFor(5)).toEqual({ rooms: 3, adultsPerRoom: 2 });
  });

  it('never asks for zero rooms', () => {
    expect(roomsFor(0).rooms).toBe(1);
  });
});

describe('nightsBetween', () => {
  it('counts whole nights', () => {
    expect(nightsBetween('2026-09-02', '2026-09-06')).toBe(4);
  });

  // A rate is divided by this. Zero would put Infinity on the card.
  it('never returns zero', () => {
    expect(nightsBetween('2026-09-02', '2026-09-02')).toBe(1);
    expect(nightsBetween('nonsense', 'also-nonsense')).toBe(1);
  });
});

describe('isLiteApiConfigured', () => {
  it('follows the key', () => {
    expect(isLiteApiConfigured()).toBe(true);

    delete process.env.LITEAPI_KEY;
    resetEnvCache();

    expect(isLiteApiConfigured()).toBe(false);
  });
});

describe('searchStays', () => {
  it('turns a stay total into a nightly rate', async () => {
    const stays = await searchStays(SEARCH);

    // 480 over four nights.
    expect(stays[0].pricePerNight).toBe(120);
    expect(stays[1].pricePerNight).toBe(80);
  });

  it('carries the rating, reviews and photo the directory never had', async () => {
    const [first] = await searchStays(SEARCH);

    expect(first).toMatchObject({
      name: 'Grand Hotel Yerevan',
      rating: 8.6,
      reviews: 1204,
      image: 'https://img.example/grand.jpg',
    });
  });

  it('asks for one room for two travellers, and two rooms for four', async () => {
    const fetchMock = stubLiteApi();
    vi.stubGlobal('fetch', fetchMock);

    await searchStays({ ...SEARCH, guests: 4 });

    expect(ratesBody(fetchMock).occupancies).toEqual([{ adults: 2 }, { adults: 2 }]);
  });

  it('sends the dates and currency the reader searched on', async () => {
    const fetchMock = stubLiteApi();
    vi.stubGlobal('fetch', fetchMock);

    await searchStays(SEARCH);

    expect(ratesBody(fetchMock)).toMatchObject({
      checkin: '2026-09-02',
      checkout: '2026-09-06',
      currency: 'USD',
    });
  });

  it('sends the key as a header, never in the URL', async () => {
    const fetchMock = stubLiteApi();
    vi.stubGlobal('fetch', fetchMock);

    await searchStays(SEARCH);

    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('sand-test-key');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['X-API-Key']).toBe('sand-test-key');
    }
  });

  /*
   * Below: a property the provider lists but will not quote. It still belongs
   * on the screen — a real stay with no price beats no stay at all — so it
   * comes back with a null rate rather than being dropped.
   */
  it('keeps a stay the provider quoted no rate for', async () => {
    vi.stubGlobal('fetch', stubLiteApi({ rates: { data: [MIN_RATES.data[0]] } }));

    const stays = await searchStays(SEARCH);

    expect(stays).toHaveLength(2);
    expect(stays[1].pricePerNight).toBeNull();
  });

  it('ignores a nonsense price rather than showing NaN', async () => {
    vi.stubGlobal(
      'fetch',
      stubLiteApi({ rates: { data: [{ hotelId: 'lp1a2b', price: 'free' }] } }),
    );

    expect((await searchStays(SEARCH))[0].pricePerNight).toBeNull();
  });

  it('answers with nothing when the provider refuses the key', async () => {
    vi.stubGlobal('fetch', stubLiteApi({ hotelsStatus: 401 }));

    expect(await searchStays(SEARCH)).toEqual([]);
  });

  it('answers with nothing when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    expect(await searchStays(SEARCH)).toEqual([]);
  });

  it('answers with nothing when the city has no properties', async () => {
    vi.stubGlobal('fetch', stubLiteApi({ hotels: { data: [] } }));

    expect(await searchStays(SEARCH)).toEqual([]);
  });

  it('still lists stays when only the rates call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) =>
        String(url).includes('/data/hotels')
          ? new Response(JSON.stringify(HOTELS), { status: 200 })
          : new Response('nope', { status: 500 }),
      ),
    );

    const stays = await searchStays(SEARCH);

    expect(stays).toHaveLength(2);
    expect(stays.every((stay) => stay.pricePerNight === null)).toBe(true);
  });

  it('does not call the provider at all without a key', async () => {
    delete process.env.LITEAPI_KEY;
    resetEnvCache();

    const fetchMock = stubLiteApi();
    vi.stubGlobal('fetch', fetchMock);

    expect(await searchStays(SEARCH)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
