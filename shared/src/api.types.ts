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
};

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
