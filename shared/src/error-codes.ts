/**
 * The vocabulary both sides agree on.
 *
 * Every error response carries one of these in `error.code`. The HTTP status
 * says what class of failure it was; the code says which failure, and it is
 * what the client maps back onto its own error types. Statuses are reused
 * across meanings — three different things return 401 — so the code, not the
 * status, is what any branch should test.
 *
 * A `const` object rather than a TS `enum`: `erasableSyntaxOnly` is on, and an
 * enum emits runtime code.
 */
export const ERROR_CODES = {
  /* auth */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** The access token was valid but has aged out — a refresh may recover it. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** A revoked refresh token was replayed; the whole family is now dead. */
  REFRESH_REUSED: 'REFRESH_REUSED',

  /* federated sign-in */
  /** The provider's token did not verify, or was not meant for us. */
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  /**
   * The provider will not vouch for the address. Everything about linking
   * rests on that claim, so an unverified one cannot be accepted.
   */
  GOOGLE_EMAIL_UNVERIFIED: 'GOOGLE_EMAIL_UNVERIFIED',
  /**
   * That email already belongs to a password account. Deliberately not linked
   * automatically — our own signups are unverified, so trusting the match
   * would let someone claim an address before its owner arrives.
   */
  GOOGLE_LINK_REQUIRED: 'GOOGLE_LINK_REQUIRED',
  /** That provider account is already attached to somebody else. */
  GOOGLE_ALREADY_LINKED: 'GOOGLE_ALREADY_LINKED',
  /** Disconnecting would leave the account with no way to sign in. */
  LAST_SIGN_IN_METHOD: 'LAST_SIGN_IN_METHOD',
  /** The server has no client id for this provider. */
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  /**
   * A provider this server depends on answered badly.
   *
   * Distinct from `INTERNAL`: nothing here is broken, and the reader's own
   * request was fine. Trying again is reasonable advice, which it is not for a
   * fault of ours.
   */
  PROVIDER_ERROR: 'PROVIDER_ERROR',

  /* generic */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /**
   * The request body was bigger than the parser will accept.
   *
   * Distinct from `VALIDATION_FAILED` because nothing about the content is
   * wrong — it never got as far as being read — and the only useful advice is
   * about size. Reachable since trips can be imported from a file the reader
   * chose, which is the first body this app does not itself compose.
   */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  /* ------------------------------------------------------------------ trips */

  TRIP_NOT_FOUND: 'TRIP_NOT_FOUND',
  /**
   * The trip changed under this edit.
   *
   * Two tabs open on one trip both read version 3 and both send a whole
   * itinerary; without this the slower write wins and the other person's
   * changes vanish with nothing to show for it.
   */
  STALE_TRIP: 'STALE_TRIP',
  DAY_NOT_FOUND: 'DAY_NOT_FOUND',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  BOOKING_ALREADY_ON_TRIP: 'BOOKING_ALREADY_ON_TRIP',
  ACTIVITY_ALREADY_ON_DAY: 'ACTIVITY_ALREADY_ON_DAY',
  /* --------------------------------------------------------------- messages */

  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  /**
   * Someone tried to withdraw a message they did not write.
   *
   * A 403 rather than a 404, unlike a trip belonging to another account: the
   * message is on their screen already, so there is no existence to conceal
   * and pretending it is missing would only be confusing.
   */
  MESSAGE_NOT_YOURS: 'MESSAGE_NOT_YOURS',

  /* ---------------------------------------------------------------- friends */

  /**
   * A conversation needs both ends to have agreed to it.
   *
   * A 403 rather than a 404: the person exists, they are findable by name on
   * the friends page, and pretending otherwise would make "add a friend"
   * impossible to explain. What is missing is permission, which is what 403
   * means.
   */
  NOT_FRIENDS: 'NOT_FRIENDS',
  FRIEND_REQUEST_NOT_FOUND: 'FRIEND_REQUEST_NOT_FOUND',

  /* ----------------------------------------------------------------- shares */

  SHARE_NOT_FOUND: 'SHARE_NOT_FOUND',
  /**
   * The offer is no longer on the table — withdrawn by whoever sent it.
   *
   * Distinct from a 404 on purpose: the card is on the recipient's screen and
   * saying it never existed would be baffling. This says what happened.
   */
  SHARE_REVOKED: 'SHARE_REVOKED',
  /** Only the sender may withdraw an offer, and only before it is taken up. */
  SHARE_NOT_YOURS: 'SHARE_NOT_YOURS',

  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  /** Client-side only: the request never reached the server. */
  NETWORK: 'NETWORK',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
