import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import {
  MissingApiKeyError,
  OpenTripMapError,
  UnknownPlaceError,
  openTripMapService,
} from './opentripmap.service';

/**
 * The attractions client, now that it talks to our API rather than to the
 * provider.
 *
 * The ranking, the filtering of unnamed places and the provider's own status
 * codes moved to `server/src/modules/places/` along with the key, and are
 * tested there. What is left here is the part that stayed: turning an API
 * failure back into the error type six call sites branch on. That mapping is
 * the whole reason those types still exist, and getting it wrong is invisible
 * until a map silently caches an outage as geography.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** The server's error envelope, as `http.ts` expects to read it. */
function errorResponse(status: number, code: string, message = 'Nope.'): Response {
  return jsonResponse({ error: { code, message, details: null } }, status);
}

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL) => implementation(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('where the requests go', () => {
  it('asks our API, never the provider', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ lat: -8.65, lon: 115.2 }));

    await openTripMapService.findDestination('Bali');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/places/geoname');
    expect(url).not.toContain('opentripmap.com');
  });

  it('sends no API key of its own', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ lat: 0, lon: 0 }));

    await openTripMapService.findDestination('Bali', 'ID');

    // The point of the whole change: the browser has no key to send.
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('apikey');
  });

  it('passes the search through as query parameters', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));

    await openTripMapService.searchPlaces({
      lat: -8.65,
      lon: 115.2,
      kinds: 'beaches',
      radius: 60000,
      limit: 40,
      minRate: 2,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toContain('/places/search');
    expect(url.searchParams.get('kinds')).toBe('beaches');
    expect(url.searchParams.get('radius')).toBe('60000');
    expect(url.searchParams.get('rate')).toBe('2');
  });

  it('escapes an id that contains a slash', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ xid: 'x', name: 'Place' }));

    await openTripMapService.getPlaceDetails('W311/676978');

    expect(String(fetchMock.mock.calls[0][0])).toContain('W311%2F676978');
  });
});

describe('findDestination', () => {
  it('returns coordinates', async () => {
    stubFetch(async () => jsonResponse({ name: 'Bali', lat: -8.65, lon: 115.21667, country: 'ID' }));

    await expect(openTripMapService.findDestination('Bali')).resolves.toEqual({
      name: 'Bali',
      lat: -8.65,
      lon: 115.21667,
      country: 'ID',
    });
  });
});

describe('turning an API failure back into the right error', () => {
  it('reads a 404 as a place that does not exist', async () => {
    stubFetch(async () => errorResponse(404, ERROR_CODES.NOT_FOUND));

    // Durable: `geocode.service` caches this answer rather than retrying it.
    await expect(openTripMapService.findDestination('Atlantis')).rejects.toBeInstanceOf(
      UnknownPlaceError,
    );
  });

  it('names the place it could not find', async () => {
    stubFetch(async () => errorResponse(404, ERROR_CODES.NOT_FOUND));

    await expect(openTripMapService.findDestination('Atlantis')).rejects.toThrow(/Atlantis/);
  });

  it('reads an unconfigured server as a missing key', async () => {
    stubFetch(async () => errorResponse(503, ERROR_CODES.PROVIDER_NOT_CONFIGURED));

    await expect(openTripMapService.findDestination('Bali')).rejects.toBeInstanceOf(
      MissingApiKeyError,
    );
  });

  it('keeps a provider outage transient rather than durable', async () => {
    stubFetch(async () => errorResponse(502, ERROR_CODES.INTERNAL));

    const caught = await openTripMapService.findDestination('Bali').catch((error) => error);

    // The distinction that matters: a 502 must NOT arrive as UnknownPlaceError,
    // or the geocode cache remembers a timeout as "this place does not exist".
    expect(caught).toBeInstanceOf(OpenTripMapError);
    expect(caught).not.toBeInstanceOf(UnknownPlaceError);
  });

  it('carries the HTTP status', async () => {
    stubFetch(async () => errorResponse(429, ERROR_CODES.RATE_LIMITED));

    await expect(
      openTripMapService.searchPlaces({ lat: 0, lon: 0, kinds: 'beaches', radius: 1000, limit: 1 }),
    ).rejects.toMatchObject({ name: 'OpenTripMapError', status: 429 });
  });

  it('reports an unreachable server', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(openTripMapService.findDestination('Bali')).rejects.toThrow(/Could not reach/);
  });

  it('surfaces a details failure rather than a half-built record', async () => {
    stubFetch(async () => errorResponse(502, ERROR_CODES.INTERNAL));

    await expect(openTripMapService.getPlaceDetails('missing')).rejects.toThrow(OpenTripMapError);
  });
});

describe('OpenTripMapError', () => {
  it('is an Error', () => {
    expect(new OpenTripMapError('boom')).toBeInstanceOf(Error);
  });
});
