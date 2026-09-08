import type { ErrorCode } from './error-codes';

/**
 * The wire contract between the SPA and the API.
 *
 * Types only — no zod here. The schemas that validate these shapes live at
 * `@ai-travel/shared/schemas`, a separate export path, so the validation
 * library never follows a type import into the client bundle.
 */

/** Every error response, whatever the status. */
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details: unknown;
  };
};

export type AuthProvider = 'google';

/** An external account attached to a user, as the profile screen shows it. */
export type ApiIdentity = {
  provider: AuthProvider;
  /** The address the provider reported, or null if it did not. */
  email: string | null;
};

/** The signed-in person, as `GET /api/me` and the auth endpoints return them. */
/**
 * App preferences, as the wire carries them.
 *
 * Deliberately the same shape as the SPA's own `AppSettings`, so the client can
 * hold what it is given rather than mapping it. Every field has a default, so
 * an account that has never opened the settings screen still gets a complete
 * record.
 */
export type ApiSettings = {
  /**
   * The chosen appearance — `sharpen`, `atlas` or `console`.
   *
   * Still named `theme` because that is the column and the storage key.
   * Records written before the appearances existed hold `'system'`, `'light'`
   * or `'dark'`; the server narrows those to `'sharpen'` on read, so nothing
   * downstream has to know they ever existed.
   */
  theme: 'sharpen' | 'atlas' | 'console';
  /**
   * ISO 4217. Display only: prices are quoted and stored in USD and converted
   * at render time.
   */
  currency: string;
  notifications: {
    tripReminders: boolean;
    priceAlerts: boolean;
  };
  /**
   * How this account wants its days planned.
   *
   * Read by the itinerary scheduler, which is the engine behind every trip
   * neither tier pays for: hours, the categories somebody actually wants, and
   * what they will spend. Every field has a default, so an account that has
   * never opened the settings screen still gets a complete record and a
   * complete trip.
   *
   * The category weights are a partial map on the wire. A client that has not
   * been updated for a seventh category must not have its silence read as a
   * zero — zero means "never show me this", which is a preference nobody
   * expressed by shipping an old bundle.
   */
  travel: ApiTravelPreferences;
};

export type ApiTravelPreferences = {
  /** `HH:MM`. */
  dayStart: string;
  /** `HH:MM`. */
  dayEnd: string;
  pace: 'relaxed' | 'balanced' | 'packed';
  categoryWeights: Record<string, number>;
  /** USD per person, whole dollars. Null for no ceiling. */
  maxActivityPrice: number | null;
  /** USD per person across one day. Null for no limit. */
  dailyActivityBudget: number | null;
  meals: { lunch: boolean; dinner: boolean };
};

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  /**
   * Always false. Kept because the client's `User` type carries it from the
   * days when everyone was a guest; it disappears when that type does.
   */
  isGuest: false;
  createdAt: string;
  /**
   * Providers this account can sign in with. Returned alongside the user so
   * the profile screen needs no second round trip.
   */
  identities: ApiIdentity[];
  /**
   * Whether a password is set. Drives whether disconnecting the last provider
   * is offered — doing so with no password would lock the account.
   */
  hasPassword: boolean;
  /**
   * App preferences, returned with the account rather than from an endpoint of
   * their own — see `activeTripId` below for why boot is one request.
   */
  settings: ApiSettings;
  /**
   * The trip last opened, so a reload can offer to resume it.
   *
   * Returned here rather than from an endpoint of its own so that app boot
   * stays one round trip. Null when nothing has been opened, or when that
   * trip has since been deleted.
   */
  activeTripId: string | null;
  /**
   * Which planner this account gets.
   *
   * Rides the user for the same reason `settings` does: the planner has to
   * know which engine to run before the first prompt, and a second round trip
   * to find out would be one the free tier never needed.
   */
  plan: UserPlan;
  /** ISO timestamp, or null on a free account. What the profile shows. */
  proSince: string | null;
};

/**
 * The two tiers.
 *
 * A union rather than an enum, matching the schema: the database column is a
 * string, and one spelling of the values is enough.
 */
export type UserPlan = 'free' | 'pro';

export type GoogleCredentialRequest = {
  /** The ID token the Google Identity Services button handed the browser. */
  credential: string;
};

/**
 * A fresh access token.
 *
 * `expiresIn` is seconds, not a timestamp: the client's clock may be wrong,
 * and a duration is immune to that in a way an absolute time is not.
 */
export type AccessTokenResponse = {
  accessToken: string;
  expiresIn: number;
  /**
   * The refresh token, for a client that cannot hold an httpOnly cookie.
   *
   * **Absent for the browser, and that is the point.** The web's session lives
   * in a cookie JavaScript cannot read; sending this to it would put the one
   * long-lived credential in reach of any injected script. It appears only
   * when a request both asks for it (`x-refresh-transport: body`) and presents
   * no cookie — see `wantsBodyToken` in `auth.routes.ts`.
   *
   * Optional, so the web client compiles and behaves exactly as before.
   */
  refreshToken?: string;
  /** ISO timestamp. When the whole sign-in ends, not when this token rotates. */
  refreshExpiresAt?: string;
};

/** Register and login both answer with the session and the person. */
export type AuthSessionResponse = AccessTokenResponse & {
  user: ApiUser;
};

export type RegisterRequest = {
  name: string;
  email: string;
  password: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type UpdateMeRequest = {
  name?: string;
};
