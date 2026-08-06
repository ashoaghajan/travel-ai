import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError, getAccessToken, http, request, setAccessToken, signedOut } from './http';

/** A JSON response, as the server would send it. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorBody(code: string, message = 'No.') {
  return { error: { code, message, details: null } };
}

function mockFetch() {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Answer every call with an equivalent response.
 *
 * A `Response` body can only be read once, so a test making several requests
 * needs a fresh instance per call rather than one shared object.
 */
function alwaysRespond(fetchMock: ReturnType<typeof mockFetch>, status: number, body: unknown) {
  fetchMock.mockImplementation(() => Promise.resolve(json(status, body)));
}

/** The path each call was made to, in order. */
function paths(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

/** The `RequestInit` of one call, and the headers it carried. */
function initOf(fetchMock: ReturnType<typeof mockFetch>, call = 0): RequestInit {
  return fetchMock.mock.calls[call][1] ?? {};
}

function headersOf(fetchMock: ReturnType<typeof mockFetch>, call = 0): Record<string, string> {
  return (initOf(fetchMock, call).headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('returns the parsed body of a successful call', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, { id: 'u_1' }));

    await expect(request('/me')).resolves.toEqual({ id: 'u_1' });
    expect(paths(fetchMock)).toEqual(['/api/me']);
  });

  it('sends the access token once one is set', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, {}));
    setAccessToken('token-1');

    await request('/me');

    expect(headersOf(fetchMock).Authorization).toBe('Bearer token-1');
  });

  it('sends no Authorization header while signed out', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, {}));

    await request('/me');

    expect(headersOf(fetchMock).Authorization).toBeUndefined();
  });

  it('always sends credentials, so the refresh cookie rides along', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, {}));

    await request('/me');

    expect(initOf(fetchMock).credentials).toBe('include');
  });

  it('reads 204 as nothing rather than failing to parse it', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(request('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('appends query parameters and drops the undefined ones', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, {}));

    await request('/trips', { query: { limit: 10, cursor: undefined, draft: false } });

    expect(paths(fetchMock)).toEqual(['/api/trips?limit=10&draft=false']);
  });

  it('surfaces the server error code and message', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(409, errorBody(ERROR_CODES.EMAIL_TAKEN, 'That email is taken.')));

    const error = await request('/auth/register', { method: 'POST' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe(ERROR_CODES.EMAIL_TAKEN);
    expect((error as ApiError).message).toBe('That email is taken.');
  });

  it('copes with an error body that is not our envelope', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    const error = (await request('/me').catch((caught: unknown) => caught)) as ApiError;

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
    expect(error.message).toBe('The server returned 502.');
  });

  it('maps a dead network to a NETWORK error rather than letting TypeError escape', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await request('/me').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe(ERROR_CODES.NETWORK);
  });

  it('lets an abort through untouched — the caller asked for it', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(request('/me')).rejects.toBeInstanceOf(DOMException);
  });
});

describe('refresh on an expired token', () => {
  it('refreshes once, then retries the original request', async () => {
    const fetchMock = mockFetch();
    setAccessToken('stale');

    fetchMock
      .mockResolvedValueOnce(json(401, errorBody(ERROR_CODES.TOKEN_EXPIRED)))
      .mockResolvedValueOnce(json(200, { accessToken: 'fresh', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { id: 'u_1' }));

    await expect(request('/me')).resolves.toEqual({ id: 'u_1' });
    expect(paths(fetchMock)).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
    expect(getAccessToken()).toBe('fresh');
  });

  // Rotation invalidates the old cookie, so a second concurrent refresh would
  // present a dead token and trip the reuse detector.
  it('fires exactly one refresh for many simultaneous failures', async () => {
    const fetchMock = mockFetch();
    setAccessToken('stale');

    fetchMock.mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/auth/refresh')) {
        return Promise.resolve(json(200, { accessToken: 'fresh', expiresIn: 900 }));
      }
      return Promise.resolve(
        getAccessToken() === 'fresh'
          ? json(200, { ok: true })
          : json(401, errorBody(ERROR_CODES.TOKEN_EXPIRED)),
      );
    });

    const results = await Promise.all([
      request('/a'),
      request('/b'),
      request('/c'),
      request('/d'),
      request('/e'),
    ]);

    expect(results).toHaveLength(5);
    expect(paths(fetchMock).filter((path) => path.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('gives up after one retry rather than looping', async () => {
    const fetchMock = mockFetch();
    setAccessToken('stale');

    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).endsWith('/auth/refresh')
          ? json(200, { accessToken: 'fresh', expiresIn: 900 })
          : json(401, errorBody(ERROR_CODES.TOKEN_EXPIRED)),
      ),
    );

    await expect(request('/me')).rejects.toBeInstanceOf(ApiError);
    expect(paths(fetchMock)).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
  });

  it('does not try to refresh an UNAUTHENTICATED response', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(401, errorBody(ERROR_CODES.UNAUTHENTICATED)));

    await expect(request('/me')).rejects.toBeInstanceOf(ApiError);
    expect(paths(fetchMock)).toEqual(['/api/me']);
  });

  it('clears the token and announces the sign-out when refresh fails', async () => {
    const fetchMock = mockFetch();
    setAccessToken('stale');

    const listener = vi.fn();
    const unsubscribe = signedOut.subscribe(listener);

    fetchMock
      .mockResolvedValueOnce(json(401, errorBody(ERROR_CODES.TOKEN_EXPIRED)))
      .mockResolvedValueOnce(json(401, errorBody(ERROR_CODES.REFRESH_REUSED)));

    const error = (await request('/me').catch((caught: unknown) => caught)) as ApiError;

    expect(error.message).toBe('Your session has ended. Please sign in again.');
    expect(getAccessToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('stops listening once unsubscribed', async () => {
    const fetchMock = mockFetch();
    const listener = vi.fn();
    signedOut.subscribe(listener)();

    fetchMock.mockResolvedValue(json(401, errorBody(ERROR_CODES.UNAUTHENTICATED)));
    await request('/me').catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('http verbs', () => {
  it('serialises a JSON body and sets the content type', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, {}));

    await http.post('/auth/login', { email: 'a@b.co' });

    expect(initOf(fetchMock).method).toBe('POST');
    expect(initOf(fetchMock).body).toBe('{"email":"a@b.co"}');
    expect(headersOf(fetchMock)['Content-Type']).toBe('application/json');
  });

  it('sends no body or content type on a bare GET', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, {}));

    await http.get('/me');

    expect(initOf(fetchMock).body).toBeUndefined();
    expect(headersOf(fetchMock)['Content-Type']).toBeUndefined();
  });

  it('maps each verb onto its method', async () => {
    const fetchMock = mockFetch();
    alwaysRespond(fetchMock, 200, {});

    await http.patch('/me', { name: 'A' });
    await http.put('/me/active-trip', { tripId: null });
    await http.delete('/trips/t_1');

    expect(fetchMock.mock.calls.map((_, index) => initOf(fetchMock, index).method)).toEqual([
      'PATCH',
      'PUT',
      'DELETE',
    ]);
  });
});
