import { ERROR_CODES } from '@ai-travel/shared';
/*
 * DIFFERS FROM WEB (2/5): a fetch that can stream.
 *
 * React Native's built-in fetch is XHR-backed and leaves `response.body`
 * undefined, which would make `stream()` below throw "the server sent an empty
 * stream" on every Pro planner turn. `expo/fetch` is WinterCG-compliant and
 * hands back a real ReadableStream.
 *
 * Imported under a name rather than relied on as the global: Expo does install
 * it as the global `fetch` on native, but that is a default somebody can turn
 * off with EXPO_PUBLIC_USE_RN_FETCH, and this file should not break quietly if
 * they do.
 */
import { fetch as streamingFetch } from 'expo/fetch';
import type { AccessTokenResponse, ApiErrorBody, ErrorCode } from '@ai-travel/shared';

/**
 * The one place the SPA talks to the API.
 *
 * No React component may import this file — services call it, components call
 * services.
 *
 * It owns two things beyond `fetch`: the access token, and what to do when the
 * server says that token has expired.
 *
 * The access token lives in a module variable rather than storage. An XSS that
 * sweeps `localStorage` finds nothing, and because the token is attached by
 * hand rather than by the browser, there is no CSRF surface to defend. The
 * cost is that a page reload starts with no token — which is why `AuthBootstrap`
 * exists, and why the refresh cookie is `httpOnly` and outlives the tab.
 */

/*
 * DIFFERS FROM WEB (1/5): where the API is.
 *
 * The web defaults to the relative `/api`, which is what makes it same-origin
 * and is why it needs no CORS. A phone has no origin to be the same as, so the
 * URL is always absolute and always supplied.
 *
 * `process.env.EXPO_PUBLIC_*` rather than `import.meta.env`: Metro's Babel
 * cannot *parse* `import.meta`, so it is a build error rather than a runtime
 * one, and an unreachable branch would still break the bundle.
 */
const BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://travel-ai-io1t.onrender.com/api';

/** An error the server described, or a network failure dressed as one. */
export class ApiError extends Error {
  /** 0 when the request never reached the server. */
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Set by the retry path so one failed refresh cannot loop. */
  isRetry?: boolean;
  /** Refresh and logout carry the cookie instead, and must not recurse. */
  skipAuth?: boolean;
};

/* --------------------------------------------------------------- the token */

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/* ------------------------------------------------------------- signed out */

type Listener = () => void;
const signedOutListeners = new Set<Listener>();

/**
 * Fires when a session ends for a reason the user did not choose — a refresh
 * that failed, or a replayed token. The auth store listens and resets; the
 * route guard then redirects. Deliberately not an exception: by the time this
 * fires the request that triggered it is already lost, and every caller would
 * otherwise have to handle the same case identically.
 */
export const signedOut = {
  subscribe(listener: Listener): () => void {
    signedOutListeners.add(listener);
    return () => signedOutListeners.delete(listener);
  },
  emit(): void {
    signedOutListeners.forEach((listener) => listener());
  },
};

/* ------------------------------------------------------------- the request */

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }

  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

/**
 * A body the browser should send as it is.
 *
 * Everything this app sends is JSON except one thing: a recording, which is
 * bytes and whose type is its own. Serialising a `Blob` produces `{}` — a
 * silent, baffling failure — so it is named here rather than discovered there.
 */
function isBinary(body: unknown): body is Blob {
  return typeof Blob !== 'undefined' && body instanceof Blob;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const binary = isBinary(options.body);

  // A blob carries its own type; anything else here is JSON.
  if (options.body !== undefined) {
    headers['Content-Type'] = binary ? (options.body as Blob).type || 'application/octet-stream' : 'application/json';
  }
  if (accessToken && !options.skipAuth) headers.Authorization = `Bearer ${accessToken}`;

  try {
    return await streamingFetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined
          ? undefined
          : binary
            ? (options.body as Blob)
            : JSON.stringify(options.body),
      // Sends the refresh cookie. Same-origin in development via the Vite
      // proxy, so this costs nothing and no CORS negotiation is involved.
      /*
       * DIFFERS FROM WEB (3/5): no cookie to include.
       *
       * The web's session rides an httpOnly refresh cookie. A native client
       * cannot be trusted to persist one across a cold start, so the refresh
       * token lives in SecureStore and travels in the body — see the auth
       * milestone. Sending this would imply a cookie is in play.
       */
      signal: options.signal,
    });
  } catch (caught) {
    // `fetch` rejects only for a dead network, DNS failure or an abort —
    // every HTTP status, including 500, resolves.
    /*
     * DIFFERS FROM WEB (4/5): how an abort is recognised.
     *
     * There is no `DOMException` in Hermes, so the web's check is always false
     * here and a cancelled request falls through to the network error below —
     * pressing Stop in the planner would report that the server is
     * unreachable. The name is the part that is portable.
     */
    if ((caught as Error | undefined)?.name === 'AbortError') throw caught;

    throw new ApiError(0, ERROR_CODES.NETWORK, 'We could not reach the server.');
  }
}

/** The server's error envelope, or a usable stand-in when it sent something else. */
async function readError(response: Response): Promise<{ code: ErrorCode; message: string; details: unknown }> {
  const fallback = {
    code: ERROR_CODES.INTERNAL as ErrorCode,
    message: `The server returned ${response.status}.`,
    details: null as unknown,
  };

  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (!body.error?.code) return fallback;

    return {
      code: body.error.code,
      message: body.error.message || fallback.message,
      details: body.error.details ?? null,
    };
  } catch {
    // A proxy error page, an empty body, or HTML from a misrouted path.
    return fallback;
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, ERROR_CODES.INTERNAL, 'The server sent a malformed response.');
  }
}

/* ---------------------------------------------------------------- refresh */

let refreshing: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await send('/auth/refresh', { method: 'POST', skipAuth: true });
    if (!response.ok) return false;

    const { accessToken: token } = await parse<AccessTokenResponse>(response);
    accessToken = token;
    return true;
  } catch {
    return false;
  }
}

/**
 * A request, with one recovery attempt when the access token has merely aged.
 *
 * The refresh is single-flight: five requests failing together must not fire
 * five refreshes, because rotation would then invalidate four of them and the
 * reuse detector would kill the session outright.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (response.ok) {
    lastSuccessAt = Date.now();
    return parse<T>(response);
  }

  const { code, message, details } = await readError(response);

  if (response.status !== 401) throw new ApiError(response.status, code, message, details);

  if (code === ERROR_CODES.TOKEN_EXPIRED && !options.isRetry && !options.skipAuth) {
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });

    if (await refreshing) return request<T>(path, { ...options, isRetry: true });
  }

  // Unrecoverable: no token, a dead refresh, or a replayed one.
  accessToken = null;
  signedOut.emit();

  throw new ApiError(401, code, 'Your session has ended. Please sign in again.', details);
}

/* --------------------------------------------------------------- keeping warm */

/**
 * When the API last answered anything successfully.
 *
 * Null until it has. Only the keep-warm ping reads it, but it is recorded here
 * because this is the one place that knows a request succeeded — a service
 * tracking its own calls would miss every other service's.
 */
let lastSuccessAt: number | null = null;

/** Render's free tier sleeps after fifteen idle minutes; ten leaves a margin. */
const WARM_FOR_MS = 10 * 60 * 1000;

/**
 * Wakes the API if it has probably gone to sleep.
 *
 * Called when somebody focuses the composer — a human about to type is the
 * signal, which is the whole design. **No interval.** A periodic ping would
 * burn the free tier's instance-hours and defeat the sleeping it exists to
 * work around; this fires at most once per ten minutes, and only when a person
 * is actually there.
 *
 * `skipAuth`, so a ping can never be the request that discovers an expired
 * token and signs somebody out. Failures are swallowed: this is a nudge, and
 * nothing downstream is waiting on it.
 */
export function keepWarm(): void {
  if (lastSuccessAt !== null && Date.now() - lastSuccessAt < WARM_FOR_MS) return;

  // Recorded before the answer, so a slow wake-up cannot queue a second ping
  // behind the first.
  lastSuccessAt = Date.now();

  void request('/health', { skipAuth: true }).catch(() => {
    // It was asleep and is now waking, or it is down and the next real request
    // will say so properly.
  });
}

/** Testing seam: there is one module-level clock and suites must not share it. */
export function resetWarmth(): void {
  lastSuccessAt = null;
}

/* ----------------------------------------------------------------- streaming */

/**
 * A request whose body is read as it arrives, one server-sent event at a time.
 *
 * Not `EventSource`, which would be the obvious tool: it cannot send an
 * `Authorization` header, and it can only issue a GET. This app's access token
 * lives in a module variable rather than a cookie, so the header is the only
 * way the server learns who is asking — which rules `EventSource` out entirely
 * and leaves `fetch` plus a reader over `response.body`.
 *
 * Everything else matches `request`: the same token, the same single-flight
 * refresh on a stale one, the same `signedOut` emission when that fails. Only
 * the reading differs.
 *
 * Yields each frame's `data:` payload, already parsed. A failure before the
 * stream opens throws `ApiError` exactly as `request` would; a failure after it
 * has opened cannot, because the status line is long gone — those arrive as
 * events in the stream, and the caller reads them.
 */
export async function* stream<T>(
  path: string,
  options: RequestOptions = {},
): AsyncGenerator<T, void, undefined> {
  const response = await send(path, { ...options, method: options.method ?? 'POST' });

  if (!response.ok) {
    const { code, message, details } = await readError(response);

    if (response.status !== 401) throw new ApiError(response.status, code, message, details);

    if (code === ERROR_CODES.TOKEN_EXPIRED && !options.isRetry && !options.skipAuth) {
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });

      if (await refreshing) {
        yield* stream<T>(path, { ...options, isRetry: true });
        return;
      }
    }

    accessToken = null;
    signedOut.emit();

    throw new ApiError(401, code, 'Your session has ended. Please sign in again.', details);
  }

  if (!response.body) {
    throw new ApiError(response.status, ERROR_CODES.INTERNAL, 'The server sent an empty stream.');
  }

  /*
   * DIFFERS FROM WEB (5/5): decoding.
   *
   * Hermes has `TextDecoder` but not `TextDecoderStream`, so the web's
   * `pipeThrough` has nothing to pipe through. Decoding each chunk with
   * `{ stream: true }` is the same operation done by hand — it keeps the
   * multi-byte character that straddles two chunks intact, which is the only
   * thing the stream variant was doing for us.
   */
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  /*
   * A frame is only complete at `\n\n`, and a chunk boundary can fall anywhere
   * — including mid-word inside a `data:` line. So chunks accumulate here and
   * are only cut on that terminator; splitting each chunk on its own would
   * corrupt every frame unlucky enough to straddle two.
   */
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .join('\n');

        // Comment frames (`:keep-alive`) and blank ones carry no payload.
        if (!data) continue;

        try {
          yield JSON.parse(data) as T;
        } catch {
          // One unreadable frame is not worth ending a conversation over.
        }
      }
    }
  } finally {
    // Runs on an early `return` from the consumer too — a component that
    // unmounts mid-reply must not leave the socket held open. Cancelling
    // through the decoder never rejects, however the source behaves, so this
    // needs no guard of its own.
    await reader.cancel();
  }
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
