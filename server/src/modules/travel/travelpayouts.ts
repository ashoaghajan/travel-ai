import { ERROR_CODES } from '@ai-travel/shared';
import { HttpError } from '../../errors';
import { env } from '../../env';

/**
 * The Travelpayouts client.
 *
 * One reason this module exists at all: the API token is a real secret, and a
 * browser calling the provider directly would publish it. Everything the SPA
 * needs is therefore fetched here and handed on already mapped.
 *
 * Nothing in this file knows what a `Flight` is — it speaks the provider's
 * dialect and returns rows. The mappers translate.
 */

const BASE_URL = 'https://api.travelpayouts.com';

/** Provider responses are wrapped; `data` is only meaningful when `success`. */
type Envelope<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};

/** Thrown when the token is unset — a configuration fact, not a failure. */
export function providerNotConfigured(): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.PROVIDER_NOT_CONFIGURED,
    'Live prices are not configured on this server.',
  );
}

export function isConfigured(): boolean {
  return Boolean(env().TRAVELPAYOUTS_TOKEN);
}

/** The affiliate marker, or null when this deployment earns nothing. */
export function marker(): string | null {
  return env().TRAVELPAYOUTS_MARKER ?? null;
}

/**
 * A GET against the provider.
 *
 * The token travels as a header rather than a query parameter — the provider
 * accepts either, and a header does not end up in access logs or in the
 * `Referer` of anything.
 */
export async function providerGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const token = env().TRAVELPAYOUTS_TOKEN;
  if (!token) throw providerNotConfigured();

  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;

  try {
    response = await fetch(url, {
      headers: { 'X-Access-Token': token, Accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    // DNS, TLS, timeout: the provider is unreachable rather than unhappy.
    throw new HttpError(
      502,
      ERROR_CODES.INTERNAL,
      'We could not reach our pricing partner.',
      cause instanceof Error ? cause.message : null,
    );
  }

  if (response.status === 429) {
    throw new HttpError(429, ERROR_CODES.RATE_LIMITED, 'Too many price lookups. Try again shortly.');
  }

  if (!response.ok) {
    throw new HttpError(502, ERROR_CODES.INTERNAL, 'Our pricing partner returned an error.');
  }

  const body = (await response.json()) as Envelope<T>;

  // `success: false` with a 200 is a shape the provider really does use.
  if (!body.success || body.data === null) {
    throw new HttpError(
      502,
      ERROR_CODES.INTERNAL,
      body.error ?? 'Our pricing partner returned an error.',
    );
  }

  return body.data;
}
