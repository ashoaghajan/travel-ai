import { z } from 'zod';

/**
 * Configuration, validated once at boot.
 *
 * A server that is going to fail for want of a secret should fail while
 * starting, with the name of the missing variable, rather than at 3am on the
 * first request that needed it.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 3001 rather than the conventional 3000, which another project on this
  // machine already occupies. Change it here and in the Vite proxy together.
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),

  /**
   * Signs access tokens. Rotating it invalidates every access token in the
   * wild, which is at most 15 minutes of inconvenience — refresh cookies are
   * unaffected because they are opaque, not signed.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),

  /**
   * How long a sign-in lasts, counted from the sign-in itself.
   *
   * An absolute cap, not an idle timeout: rotation inherits the deadline the
   * session was born with rather than pushing it forward, so six hours means
   * six hours whether the reader was busy or asleep. The alternative — a
   * sliding window — never signs an active user out at all, which is exactly
   * the behaviour this replaces.
   */
  SESSION_TTL_HOURS: z.coerce.number().positive().default(6),

  /**
   * The Google OAuth web client id, used as the audience when verifying an ID
   * token. Public — it is compiled into the SPA as well — and no client secret
   * is involved: verification only checks Google's signature and the audience.
   *
   * Optional, so the app still boots for anyone who has not set up a Google
   * project. The Google endpoints answer `PROVIDER_NOT_CONFIGURED` without it.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),

  /**
   * Travelpayouts API token — real flight and hotel prices.
   *
   * A genuine secret: it stays here and never reaches the browser, which is
   * the whole reason the search endpoints exist rather than the SPA calling
   * the provider directly.
   *
   * Optional, on the same reasoning as `GOOGLE_CLIENT_ID`. Without it the
   * search endpoints answer `PROVIDER_NOT_CONFIGURED`, the client falls back
   * to sample data and says so, and someone cloning this repo without a
   * Travelpayouts account still gets a working app.
   */
  TRAVELPAYOUTS_TOKEN: z.string().min(1).optional(),

  /**
   * The affiliate marker, added to every outbound booking link.
   *
   * Not a secret — it ships inside URLs the reader can see — but it lives
   * server-side anyway so that exactly one place decides how links are built.
   * Without it the links still work; they simply earn nothing.
   */
  TRAVELPAYOUTS_MARKER: z.string().min(1).optional(),

  /**
   * OpenTripMap — the places directory behind hotel listings and the
   * attractions explorer.
   *
   * The only copy of this key. It was previously compiled into the browser
   * bundle as `VITE_OPENTRIPMAP_API_KEY` and readable by anyone who loaded the
   * site, so any key used before `/api/places` existed is public and has to be
   * rotated rather than relocated.
   *
   * Optional: without it `GET /api/hotels/search` falls back to sample stays,
   * and `GET /api/places/*` answers `PROVIDER_NOT_CONFIGURED`, which the
   * explorer reports as a server configuration problem rather than an empty
   * result.
   */
  OPENTRIPMAP_API_KEY: z.string().min(1).optional(),

  /**
   * LiteAPI — the hotel *pricing* provider, and the only one reachable.
   *
   * Amadeus was the obvious candidate and is not usable: its API hostnames
   * (`api.amadeus.com`, `test.api.amadeus.com`) carry no DNS record at all,
   * confirmed against Amadeus's own authoritative nameserver. Hotellook, the
   * Travelpayouts hotel brand, has retired its API surface entirely. Neither
   * is a credentials problem, so neither is fixed by asking for access.
   *
   * A genuine secret, like `TRAVELPAYOUTS_TOKEN`. The sandbox key is free and
   * self-serve from the LiteAPI dashboard.
   *
   * Optional, and the degradation is graceful rather than fatal: without it
   * `GET /api/hotels/search` still answers with real stays from OpenTripMap
   * and `pricePerNight: null`, which is what it did before this existed.
   */
  LITEAPI_KEY: z.string().min(1).optional(),

  /**
   * Viator — the provider that prices things to do.
   *
   * A genuine secret, on the same footing as `LITEAPI_KEY`. The affiliate key
   * is free and self-serve: Viator's Basic access needs no pre-authorisation,
   * which is why it is here rather than GetYourGuide or Tiqets, both of which
   * gate their APIs behind partner approval.
   *
   * Optional. Without it `GET /api/activities/search` answers with nothing and
   * the client keeps listing unpriced OpenTripMap attractions, exactly as it
   * did before this existed.
   */
  VIATOR_API_KEY: z.string().min(1).optional(),

  /**
   * Ably — the realtime channel behind the lobby.
   *
   * A genuine secret, and the one key here that must never be handed to a
   * browser: it can publish and subscribe to everything. What the browser gets
   * is a token this server signs from it, pinned to one user id and one
   * channel, which is why the whole flow goes through `GET /api/lobby/token`
   * rather than a `VITE_` variable.
   *
   * Give it a key limited to `publish, subscribe, presence` on `lobby:*`
   * rather than the root key. Note it needs `presence` even though this server
   * never enters the presence set: a token's rights are the intersection of
   * what it asks for and what the signing key holds, so a key without it would
   * quietly mint tokens that cannot show who is online.
   *
   * Optional, and the degradation is deliberate: without it the lobby still
   * works as a room you refresh — messages are saved, history loads, sends
   * succeed — and only the live delivery is missing. `GET /api/lobby/token`
   * answers `PROVIDER_NOT_CONFIGURED` and the panel says so.
   */
  ABLY_API_KEY: z.string().min(1).optional(),

  /**
   * Anthropic API key — the model behind the planner conversation.
   *
   * A genuine secret, on the same footing as `TRAVELPAYOUTS_TOKEN`: it must
   * never be copied into a `VITE_` variable, because anything with that prefix
   * is compiled into the browser bundle. It is also the only key here that
   * costs money per request, which is why `/api/planner/chat` sits behind both
   * a throttle and `requireAuth`.
   *
   * Optional, on the same reasoning as `TRAVELPAYOUTS_TOKEN`. Without it the
   * planner endpoint answers `PROVIDER_NOT_CONFIGURED` and the client falls
   * back to its own rules engine — weather and location lookups still work, and
   * trip requests still produce a template itinerary — so someone cloning this
   * repo without an Anthropic account still gets a working planner.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Turns off the credential throttles.
   *
   * Only ever set by the test suite, which deliberately fails login over and
   * over and would otherwise throttle itself. Named for what it does so that
   * finding it set in a production environment is unmistakable.
   */
  DISABLE_RATE_LIMIT: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid server configuration:\n${problems}`);
  }

  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/**
 * Testing seam. The cache is filled on the first read, which happens at import
 * time, so a test that changes the environment afterwards would otherwise see
 * the old values for the rest of the run.
 */
export function resetEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}
