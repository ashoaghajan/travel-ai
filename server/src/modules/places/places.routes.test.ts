import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { api, errorCode } from '../../test/harness';
import { resetEnvCache } from '../../env';
import { resetPlacesCache } from './places.routes';

/**
 * `GET /api/places/*`.
 *
 * The provider is stubbed at `fetch`. Two things matter here above the rest.
 *
 * First, **the key must never leave the server** — that is the entire reason
 * this module exists, and a regression would be invisible from the outside.
 * Second, an unknown place and an unreachable provider must stay
 * distinguishable by status: the client's geocode cache remembers a 404
 * forever and retries a 502, so collapsing them makes the map remember an
 * outage as geography.
 */

const GEONAME = '/api/places/geoname';
const SEARCH = '/api/places/search';
const METRO = '/api/places/metro';

/** Declares `fetch`'s parameters so the call log stays typed — several tests
 *  assert on the URL the provider was given. */
function providerAnswers(body: unknown, status = 200) {
  return vi.fn(
    async (_url: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

beforeEach(() => {
  process.env.OPENTRIPMAP_API_KEY = 'test-key';
  resetEnvCache();
  resetPlacesCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENTRIPMAP_API_KEY;
  resetEnvCache();
  resetPlacesCache();
});

describe('the key', () => {
  it('goes to the provider and not to the caller', async () => {
    const provider = providerAnswers({ name: 'Bali', lat: -8.65, lon: 115.2 });
    vi.stubGlobal('fetch', provider);

    const response = await api().get(GEONAME).query({ name: 'Bali' }).expect(200);

    expect(String(provider.mock.calls[0][0])).toContain('apikey=test-key');
    expect(JSON.stringify(response.body)).not.toContain('test-key');
  });

  it('says so plainly when it is not configured', async () => {
    delete process.env.OPENTRIPMAP_API_KEY;
    resetEnvCache();

    const response = await api().get(GEONAME).query({ name: 'Bali' }).expect(503);

    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  });

  it('reports a key the provider rejects as our problem, not the reader’s', async () => {
    vi.stubGlobal('fetch', providerAnswers({ error: 'Unauthorized' }, 401));

    const response = await api().get(GEONAME).query({ name: 'Bali' }).expect(503);

    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  });
});

describe('GET /api/places/geoname', () => {
  it('returns coordinates', async () => {
    vi.stubGlobal('fetch', providerAnswers({ name: 'Bali', lat: -8.65, lon: 115.2, country: 'ID' }));

    const response = await api().get(GEONAME).query({ name: 'Bali' }).expect(200);

    expect(response.body).toMatchObject({ name: 'Bali', lat: -8.65, lon: 115.2 });
  });

  it('is a 404 when the provider knows no such place', async () => {
    vi.stubGlobal('fetch', providerAnswers({ error: 'not found' }));

    const response = await api().get(GEONAME).query({ name: 'Atlantis' }).expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('is a 502, not a 404, when the provider is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    // The client caches a 404 forever. A provider outage arriving as one would
    // permanently record a real town as nonexistent.
    await api().get(GEONAME).query({ name: 'Bali' }).expect(502);
  });

  it('passes the country filter through', async () => {
    const provider = providerAnswers({ name: 'Valencia', lat: 39.4, lon: -0.37 });
    vi.stubGlobal('fetch', provider);

    await api().get(GEONAME).query({ name: 'Valencia', country: 'ES' }).expect(200);

    // There is a Valencia in Spain and one in Venezuela; unfiltered, the
    // provider silently picks one.
    expect(String(provider.mock.calls[0][0])).toContain('country=ES');
  });

  it('rejects a request with no place to look up', async () => {
    await api().get(GEONAME).expect(422);
  });

  it('answers a repeated lookup from cache', async () => {
    const provider = providerAnswers({ name: 'Bali', lat: -8.65, lon: 115.2 });
    vi.stubGlobal('fetch', provider);

    await api().get(GEONAME).query({ name: 'Bali' }).expect(200);
    await api().get(GEONAME).query({ name: 'Bali' }).expect(200);

    // The quota is ours to burn, and a town does not move.
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/places/search', () => {
  const query = { lat: -8.65, lon: 115.2, kinds: 'beaches', radius: 60000, limit: 40 };

  it('ranks the most notable places first', async () => {
    vi.stubGlobal(
      'fetch',
      providerAnswers([
        { xid: 'a', name: 'Nearby but minor', rate: 1, kinds: 'beaches' },
        { xid: 'b', name: 'Famous', rate: 3, kinds: 'beaches' },
        { xid: 'c', name: 'Notable', rate: 2, kinds: 'beaches' },
      ]),
    );

    const response = await api().get(SEARCH).query(query).expect(200);

    // The provider orders by distance; a reader wants the best places nearby.
    expect(response.body.map((place: { name: string }) => place.name)).toEqual([
      'Famous',
      'Notable',
      'Nearby but minor',
    ]);
  });

  it('drops unnamed places', async () => {
    vi.stubGlobal(
      'fetch',
      providerAnswers([
        { xid: 'a', name: '', rate: 3, kinds: 'beaches' },
        { xid: 'b', name: '   ', rate: 3, kinds: 'beaches' },
        { xid: 'c', name: 'Kuta Beach', rate: 2, kinds: 'beaches' },
      ]),
    );

    const response = await api().get(SEARCH).query(query).expect(200);

    expect(response.body.map((place: { name: string }) => place.name)).toEqual(['Kuta Beach']);
  });

  it('tolerates a non-array response', async () => {
    vi.stubGlobal('fetch', providerAnswers({ error: 'nope' }));

    const response = await api().get(SEARCH).query(query).expect(200);

    expect(response.body).toEqual([]);
  });

  it('caches a search, so the second reader costs nothing', async () => {
    const fetchMock = providerAnswers([{ xid: 'a', name: 'Kuta Beach', rate: 3, kinds: 'beaches' }]);
    vi.stubGlobal('fetch', fetchMock);

    await api().get(SEARCH).query(query).expect(200);
    const second = await api().get(SEARCH).query(query).expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.body).toHaveLength(1);
  });

  it('does not cache an empty answer, which is usually the provider throttling', async () => {
    const empty = providerAnswers([]);
    vi.stubGlobal('fetch', empty);

    const first = await api().get(SEARCH).query(query).expect(200);
    expect(first.body).toEqual([]);

    /*
     * OpenTripMap answers a throttled request with 200 and nothing in it. This
     * cache holds for a day, so storing that turned a city full of museums
     * into a city with nothing in it until tomorrow — and put a template
     * itinerary with stock photographs in front of somebody who asked for a
     * real place.
     */
    vi.stubGlobal('fetch', providerAnswers([{ xid: 'a', name: 'Kuta Beach', rate: 3, kinds: 'beaches' }]));

    const second = await api().get(SEARCH).query(query).expect(200);
    expect(second.body.map((place: { name: string }) => place.name)).toEqual(['Kuta Beach']);
  });

  it('refuses an unbounded radius', async () => {
    vi.stubGlobal('fetch', providerAnswers([]));

    // One request should not be able to make itself arbitrarily expensive.
    // The explorer's real 60km search stays comfortably inside the ceiling.
    await api()
      .get(SEARCH)
      .query({ ...query, radius: 5_000_000 })
      .expect(422);
  });

  it('refuses coordinates that are not on the earth', async () => {
    vi.stubGlobal('fetch', providerAnswers([]));

    await api()
      .get(SEARCH)
      .query({ ...query, lat: 120 })
      .expect(422);
  });
});

describe('GET /api/places/detail/:xid', () => {
  it('returns the full record for one place', async () => {
    vi.stubGlobal(
      'fetch',
      providerAnswers({ xid: 'W1', name: 'Museum Bali', kinds: 'cultural,museums' }),
    );

    const response = await api().get('/api/places/detail/W1').expect(200);

    expect(response.body).toMatchObject({ xid: 'W1', name: 'Museum Bali' });
  });

  it('passes an escaped id through to the provider', async () => {
    const provider = providerAnswers({ xid: 'x', name: 'Place' });
    vi.stubGlobal('fetch', provider);

    await api().get(`/api/places/detail/${encodeURIComponent('W311/676978')}`).expect(200);

    expect(String(provider.mock.calls[0][0])).toContain('W311%2F676978');
  });
});

/**
 * `GET /api/places/metro` — Overpass, behind the same door as the rest.
 *
 * Two upstreams in one request: the destination is geocoded by OpenTripMap and
 * the stations come from Overpass. What is being pinned down here is that
 * **every failure of either is an empty list rather than an error**, because
 * the client turns the rule off for an empty list and would otherwise have to
 * decide what a 502 means about somebody's preferences.
 */
describe('GET /api/places/metro', () => {
  /** Answers the geocode first, then the Overpass query. */
  function upstreams(stations: unknown[], geocodeStatus = 200) {
    return vi.fn(async (url: URL | string) => {
      const href = String(url);

      if (href.includes('overpass')) {
        return new Response(JSON.stringify({ elements: stations }), { status: 200 });
      }

      return new Response(JSON.stringify({ name: 'Tbilisi', lat: 41.7151, lon: 44.7833 }), {
        status: geocodeStatus,
      });
    });
  }

  it('answers with the stations it found', async () => {
    vi.stubGlobal(
      'fetch',
      upstreams([
        { lat: 41.72, lon: 44.79, tags: { name: 'Rustaveli' } },
        { center: { lat: 41.73, lon: 44.8 }, tags: { name: 'Marjanishvili' } },
      ]),
    );

    const response = await api().get(METRO).query({ name: 'Tbilisi' }).expect(200);

    expect(response.body.stations).toEqual([
      { lat: 41.72, lng: 44.79, name: 'Rustaveli' },
      { lat: 41.73, lng: 44.8, name: 'Marjanishvili' },
    ]);
  });

  it('reduces a station mapped as an area to its centre', async () => {
    vi.stubGlobal('fetch', upstreams([{ center: { lat: 41.73, lon: 44.8 }, tags: {} }]));

    const response = await api().get(METRO).query({ name: 'Tbilisi' }).expect(200);

    expect(response.body.stations).toEqual([{ lat: 41.73, lng: 44.8, name: '' }]);
  });

  it('drops an element with no point at all', async () => {
    vi.stubGlobal('fetch', upstreams([{ tags: { name: 'Nowhere' } }]));

    const response = await api().get(METRO).query({ name: 'Tbilisi' }).expect(200);

    expect(response.body.stations).toEqual([]);
  });

  /* A city with no metro. Not an error, and not distinguishable from one. */
  it('answers with an empty list rather than a 404', async () => {
    vi.stubGlobal('fetch', upstreams([]));

    const response = await api().get(METRO).query({ name: 'Batumi' }).expect(200);

    expect(response.body).toEqual({ stations: [] });
  });

  it('answers with an empty list when the place cannot be geocoded', async () => {
    vi.stubGlobal('fetch', upstreams([], 404));

    const response = await api().get(METRO).query({ name: 'Nowhere' }).expect(200);

    expect(response.body).toEqual({ stations: [] });
  });

  it('answers with an empty list when Overpass is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        if (String(url).includes('overpass')) return new Response('', { status: 504 });

        return new Response(JSON.stringify({ name: 'Tbilisi', lat: 41.7151, lon: 44.7833 }), {
          status: 200,
        });
      }),
    );

    const response = await api().get(METRO).query({ name: 'Tbilisi' }).expect(200);

    expect(response.body).toEqual({ stations: [] });
  });

  it('asks Overpass once per city', async () => {
    const provider = upstreams([{ lat: 41.72, lon: 44.79, tags: { name: 'Rustaveli' } }]);
    vi.stubGlobal('fetch', provider);

    await api().get(METRO).query({ name: 'Tbilisi' }).expect(200);
    await api().get(METRO).query({ name: 'tbilisi' }).expect(200);

    // Overpass is volunteer-run and keyless. One query per city per day is the
    // difference between polite use of it and abuse of it.
    const overpassCalls = provider.mock.calls.filter(([url]) => String(url).includes('overpass'));

    expect(overpassCalls).toHaveLength(1);
  });

  it('needs a place to look up', async () => {
    // 422, like every other unparseable query on this server — the schema
    // refuses it before the route runs.
    await api().get(METRO).expect(422);
  });
});
