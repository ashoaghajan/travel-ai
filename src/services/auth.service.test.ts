import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { ApiUser } from '@ai-travel/shared';
import { authService } from './auth.service';
import { ApiError, getAccessToken, setAccessToken } from './http';

const ADA: ApiUser = {
  id: 'u_1',
  name: 'Ada',
  email: 'ada@example.com',
  isGuest: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  identities: [],
  hasPassword: true,
  activeTripId: null,
  plan: 'free',
  proSince: null,
  settings: {
    theme: 'system' as const,
    currency: 'USD',
    notifications: { tripReminders: true, priceAlerts: false },
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch() {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function paths(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

const SESSION = { user: ADA, accessToken: 'access-1', expiresIn: 900 };

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('register and login', () => {
  it('keeps the access token from a registration', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(201, SESSION));

    await expect(
      authService.register({ name: 'Ada', email: 'ada@example.com', password: 'x'.repeat(10) }),
    ).resolves.toEqual(ADA);

    expect(getAccessToken()).toBe('access-1');
    expect(paths(fetchMock)).toEqual(['/api/auth/register']);
  });

  it('keeps the access token from a sign-in', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, SESSION));

    await expect(
      authService.login({ email: 'ada@example.com', password: 'x'.repeat(10) }),
    ).resolves.toEqual(ADA);

    expect(getAccessToken()).toBe('access-1');
    expect(paths(fetchMock)).toEqual(['/api/auth/login']);
  });

  it('leaves no token behind when sign-in is refused', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      json(401, { error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: 'No.', details: null } }),
    );

    await expect(authService.login({ email: 'a@b.co', password: 'wrong' })).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(getAccessToken()).toBeNull();
  });
});

describe('logout', () => {
  it('clears the token', async () => {
    const fetchMock = mockFetch();
    setAccessToken('access-1');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await authService.logout();

    expect(getAccessToken()).toBeNull();
  });

  // A failed sign-out that left the token in place would be the worst of both
  // worlds: the server thinks you are out, the tab thinks you are in.
  it('clears the token even when the request fails', async () => {
    const fetchMock = mockFetch();
    setAccessToken('access-1');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(authService.logout()).rejects.toBeInstanceOf(ApiError);

    expect(getAccessToken()).toBeNull();
  });
});

describe('me', () => {
  it('reads the current account', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, ADA));

    await expect(authService.me()).resolves.toEqual(ADA);
    expect(paths(fetchMock)).toEqual(['/api/me']);
  });

  it('renames the account', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, { ...ADA, name: 'Ada King' }));

    await expect(authService.updateName('Ada King')).resolves.toMatchObject({ name: 'Ada King' });
    expect(paths(fetchMock)).toEqual(['/api/me']);
  });
});

describe('restore', () => {
  it('trades the cookie for a token, then reads the account', async () => {
    const fetchMock = mockFetch();
    fetchMock
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, ADA));

    await expect(authService.restore()).resolves.toEqual(ADA);

    expect(paths(fetchMock)).toEqual(['/api/auth/refresh', '/api/me']);
    expect(getAccessToken()).toBe('access-2');
  });

  // A first-time visitor has no cookie. That is an ordinary answer, not a
  // failure, and boot must not treat it as one.
  it('answers null when there is no session, without throwing', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      json(401, { error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'No.', details: null } }),
    );

    await expect(authService.restore()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('answers null when the server is unreachable', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(authService.restore()).resolves.toBeNull();
  });

  it('does not send a stale access token on the refresh', async () => {
    const fetchMock = mockFetch();
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, ADA));

    await authService.restore();

    const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('google', () => {
  it('keeps the access token from a Google sign-in', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(json(200, SESSION));

    await expect(authService.signInWithGoogle('id-token')).resolves.toEqual(ADA);

    expect(getAccessToken()).toBe('access-1');
    expect(paths(fetchMock)).toEqual(['/api/auth/google']);
    expect(initOf(fetchMock).body).toBe('{"credential":"id-token"}');
  });

  it('leaves no token behind when Google sign-in is refused', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      json(409, {
        error: { code: ERROR_CODES.GOOGLE_LINK_REQUIRED, message: 'Use your password.', details: null },
      }),
    );

    await expect(authService.signInWithGoogle('id-token')).rejects.toBeInstanceOf(ApiError);

    expect(getAccessToken()).toBeNull();
  });

  it('links and unlinks against the same path', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    await authService.linkGoogle('id-token');
    await authService.unlinkGoogle();

    expect(paths(fetchMock)).toEqual(['/api/auth/google/link', '/api/auth/google/link']);
    expect(initOf(fetchMock, 0).method).toBe('POST');
    expect(initOf(fetchMock, 1).method).toBe('DELETE');
  });
});

/** The `RequestInit` of one call. */
function initOf(fetchMock: ReturnType<typeof mockFetch>, call = 0): RequestInit {
  return fetchMock.mock.calls[call][1] ?? {};
}
