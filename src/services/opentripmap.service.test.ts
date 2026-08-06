import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MissingApiKeyError,
  OpenTripMapError,
  openTripMapService,
} from './opentripmap.service';

const KEY = 'test-key';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubEnv('VITE_OPENTRIPMAP_API_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL) => implementation(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('API key handling', () => {
  it('throws a clear error when the key is missing', async () => {
    vi.stubEnv('VITE_OPENTRIPMAP_API_KEY', '');
    stubFetch(async () => jsonResponse({}));

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(MissingApiKeyError);
  });

  it('never puts the key in the path', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ lat: -8.65, lon: 115.2 }));

    await openTripMapService.findDestination('Bali');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('apikey')).toBe(KEY);
    expect(url.pathname).not.toContain(KEY);
  });
});

describe('findDestination', () => {
  it('returns coordinates', async () => {
    stubFetch(async () =>
      jsonResponse({ name: 'Bali', lat: -8.65, lon: 115.21667, country: 'ID' }),
    );

    await expect(openTripMapService.findDestination('Bali')).resolves.toEqual({
      name: 'Bali',
      lat: -8.65,
      lon: 115.21667,
      country: 'ID',
    });
  });

  it('throws when the place is unknown', async () => {
    stubFetch(async () => jsonResponse({ error: 'not found' }));

    await expect(openTripMapService.findDestination('Atlantis')).rejects.toThrow(
      /does not know a place/,
    );
  });

  it('reports an unauthorised key', async () => {
    stubFetch(async () => jsonResponse({ error: 'Unauthorized' }, 401));

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(/rejected the API key/);
  });

  it('reports a server error', async () => {
    stubFetch(async () => jsonResponse({}, 503));

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(/returned 503/);
  });

  it('reports a network failure', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(/Could not reach/);
  });

  it('reports a timeout', async () => {
    stubFetch(async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(/did not respond/);
  });

  it('reports malformed JSON', async () => {
    stubFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        }) as unknown as Response,
    );

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(/malformed/);
  });
});

describe('searchPlaces', () => {
  const searchArgs = { lat: -8.65, lon: 115.2, kinds: 'beaches', radius: 60000, limit: 40 };

  it('passes the query through', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));

    await openTripMapService.searchPlaces({ ...searchArgs, minRate: 2 });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toContain('/radius');
    expect(url.searchParams.get('kinds')).toBe('beaches');
    expect(url.searchParams.get('radius')).toBe('60000');
    expect(url.searchParams.get('rate')).toBe('2');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('ranks the most notable places first', async () => {
    stubFetch(async () =>
      jsonResponse([
        { xid: 'a', name: 'Nearby but minor', rate: 1, kinds: 'beaches' },
        { xid: 'b', name: 'Famous', rate: 3, kinds: 'beaches' },
        { xid: 'c', name: 'Notable', rate: 2, kinds: 'beaches' },
      ]),
    );

    const places = await openTripMapService.searchPlaces(searchArgs);

    expect(places.map((place) => place.name)).toEqual(['Famous', 'Notable', 'Nearby but minor']);
  });

  it('drops unnamed places', async () => {
    stubFetch(async () =>
      jsonResponse([
        { xid: 'a', name: '', rate: 3, kinds: 'beaches' },
        { xid: 'b', name: '   ', rate: 3, kinds: 'beaches' },
        { xid: 'c', name: 'Kuta Beach', rate: 2, kinds: 'beaches' },
      ]),
    );

    const places = await openTripMapService.searchPlaces(searchArgs);

    expect(places.map((place) => place.name)).toEqual(['Kuta Beach']);
  });

  it('tolerates a non-array response', async () => {
    stubFetch(async () => jsonResponse({ error: 'nope' }));

    await expect(openTripMapService.searchPlaces(searchArgs)).resolves.toEqual([]);
  });
});

describe('getPlaceDetails', () => {
  it('returns the full record for one place', async () => {
    stubFetch(async () =>
      jsonResponse({ xid: 'W1', name: 'Museum Bali', kinds: 'cultural,museums' }),
    );

    await expect(openTripMapService.getPlaceDetails('W1')).resolves.toMatchObject({
      xid: 'W1',
      name: 'Museum Bali',
    });
  });

  it('escapes the id in the path', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ xid: 'x', name: 'Place' }));

    await openTripMapService.getPlaceDetails('W311/676978');

    expect(String(fetchMock.mock.calls[0][0])).toContain('W311%2F676978');
  });

  it('surfaces a failure rather than a half-built record', async () => {
    stubFetch(async () => jsonResponse({}, 404));

    await expect(openTripMapService.getPlaceDetails('missing')).rejects.toThrow(OpenTripMapError);
  });
});

describe('OpenTripMapError', () => {
  it('carries the HTTP status', async () => {
    stubFetch(async () => jsonResponse({}, 429));

    await expect(
      openTripMapService.searchPlaces({
        lat: 0,
        lon: 0,
        kinds: 'beaches',
        radius: 1000,
        limit: 1,
      }),
    ).rejects.toMatchObject({ name: 'OpenTripMapError', status: 429 });
  });

  it('is an Error', () => {
    expect(new OpenTripMapError('boom')).toBeInstanceOf(Error);
  });
});
