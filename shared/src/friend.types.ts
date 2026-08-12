/**
 * Friends, and the requests that become them.
 *
 * Messaging shipped open to every account, which was right for two people and
 * wrong for twenty. A conversation now needs both ends to have agreed to it:
 * one asks, the other accepts, and only then may either of them write.
 *
 * A request and a friendship are one row at different times — see
 * `Friendship.status` in the schema — so there is one shape here rather than
 * two that would have to be kept in step.
 */

/**
 * Where the reader stands with one other account.
 *
 * Written from the reader's side, always: `outgoing` means *you* asked,
 * `incoming` means they did. A single "pending" would leave every screen
 * working out which of them it was.
 */
export type FriendStatus = 'none' | 'outgoing' | 'incoming' | 'friends';

/** Somebody, and where the reader stands with them. */
export type ApiPerson = {
  id: string;
  name: string;
  status: FriendStatus;
};

/** An accepted friend. Name and id only; an email never leaves the server. */
export type ApiFriend = {
  id: string;
  name: string;
  /** When it was accepted, so a list can say "friends since". */
  since: string;
};

/** A request still waiting on somebody. */
export type ApiFriendRequest = {
  /** The other account — never the reader, in either direction. */
  id: string;
  name: string;
  /** When it was asked for. */
  createdAt: string;
};

export type ApiFriendRequests = {
  /** Waiting on the reader to answer. */
  incoming: ApiFriendRequest[];
  /** Waiting on somebody else to answer. */
  outgoing: ApiFriendRequest[];
};

/**
 * The counts the profile shows.
 *
 * `totalUsers` is a fact about the app rather than about any person, which is
 * why it can be shown to everybody: it names nobody.
 */
export type ApiFriendStats = {
  friends: number;
  incoming: number;
  outgoing: number;
  totalUsers: number;
};

/** How many accounts one search will name. */
export const PEOPLE_SEARCH_LIMIT = 100;
