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
