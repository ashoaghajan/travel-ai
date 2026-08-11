/**
 * The lobby — one public room every signed-in account shares.
 *
 * Not to be confused with `planner.types.ts`, which is the private
 * conversation between one reader and the planner. This is people talking to
 * each other, and nothing here is named `chat` for exactly that reason: the
 * word is already spoken for by the AI transcript.
 */

/** The one channel. Named so a second room could be `lobby:<something>`. */
export const LOBBY_CHANNEL = 'lobby:general';

/** Realtime event names on that channel. Unused until messages go live. */
export const LOBBY_EVENT_MESSAGE = 'message';
export const LOBBY_EVENT_DELETE = 'delete';

/**
 * The longest a message may be.
 *
 * Shared rather than duplicated because both halves need it and they must
 * agree: the composer counts down against it and refuses to send past it, and
 * the server rejects anything over it. Two copies drift, and the drift shows
 * up as a message the composer accepted and the server threw away.
 */
export const LOBBY_MESSAGE_MAX_LENGTH = 1000;

export type ApiLobbyMessage = {
  id: string;
  /** Who wrote it. The client compares this with its own id to align bubbles. */
  userId: string;
  /**
   * Their display name, joined at read time rather than stored on the row.
   *
   * Denormalising would freeze the name as it was when they sent it; joining
   * shows the one they have now. Fifty rows and one join.
   */
  authorName: string;
  body: string;
  /** ISO timestamp, from the one server clock — so every client sorts alike. */
  createdAt: string;
  /**
   * The id the sending browser minted. Echoed back so the sender can retire
   * the optimistic bubble it drew before the round trip finished.
   */
  clientMessageId: string;
};

/**
 * Somebody who can appear in the room's people list.
 *
 * Name and id, and deliberately nothing else. `ApiUser` carries an email;
 * this is the projection that exists so it cannot leak into a room everyone
 * can read.
 */
export type ApiLobbyPerson = {
  id: string;
  name: string;
};
