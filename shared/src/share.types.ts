/**
 * A trip, offered to one person through a conversation.
 *
 * The offer is a *snapshot*, frozen when it was sent: the card shows what was
 * actually offered, later edits to the original do not leak, and the offer
 * still opens after the sender has deleted the trip it came from.
 *
 * Nothing lands in the recipient's account until they accept, and accepting
 * makes a copy under the rules import already established — new ids, notes
 * travel, bookings do not. An itinerary activity is a guess and a booking is a
 * fact; you offer the guess.
 */

/** What a card in a thread needs, without the itinerary behind it. */
export type ApiTripShare = {
  id: string;
  title: string;
  destination: string;
  /** `YYYY-MM-DD`, as trips store dates — calendar days, never instants. */
  startDate: string;
  endDate: string;
  dayCount: number;
  /** When it was taken up, and null while it is still an offer. */
  acceptedAt: string | null;
  /**
   * The trip it became, in the recipient's account.
   *
   * Sent to both ends, and useful to only one: the recipient's card links to
   * it. An id is not a capability here — trips are scoped to their owner, so
   * the sender holding this string can do nothing with it.
   */
  acceptedTripId: string | null;
  /** Withdrawn by the sender before anyone took it up. */
  revokedAt: string | null;
};

/**
 * The offer with the trip inside it.
 *
 * Only fetched when somebody asks to look, because the itinerary is the large
 * half and a thread of cards has no use for it. `trip` is an `ExportedTrip` —
 * the same document `Export` writes to a file — but it is typed as `unknown`
 * here on purpose: that type belongs to the client's `tripFile.ts`, which owns
 * both ends of the format, and shared types must not become a second opinion
 * about what a trip file is.
 */
export type ApiSharedTrip = {
  share: ApiTripShare;
  trip: unknown;
};

/** How many shares one account may be handed; the rest is scrolling. */
export const SHARE_LIST_LIMIT = 100;

/**
 * The most a snapshot may weigh.
 *
 * The same ceiling `express.json` puts on a trip, because it is a trip: a trip
 * that cannot be exported cannot be shared, and the refusal says so in those
 * words rather than failing somewhere in the middle of a transaction.
 */
export const MAX_SHARE_BYTES = 1024 * 1024;
