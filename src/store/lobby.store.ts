import { useSyncExternalStore } from 'react';
import type { ApiLobbyMessage, ApiLobbyPerson } from '@ai-travel/shared';
import { lobbyService } from '../services/lobby.service';
import { storageService, STORAGE_KEYS } from '../services/localStorage.service';
import { createId } from '../utils/id';
import * as lobbyChannel from './lobbyChannel';
import type { LobbyConnection, LobbyConnectionState } from './lobbyChannel';

/**
 * The lobby's state: what has been said, who is around, and what this browser
 * has typed but not yet had acknowledged.
 *
 * Deliberately **not** `createResource`. That models one value fetched and
 * replaced whole; this is an append-only feed where the interesting cases are
 * a message arriving twice by different routes and a message that exists only
 * on this screen so far. Neither fits a single `data` slot.
 *
 * Same hand-rolled shape as `auth.store.ts` — module state, a listener set,
 * one frozen snapshot rebuilt only when something changes. Rebuilding it per
 * read would be an infinite render loop, because `useSyncExternalStore`
 * compares snapshots with `Object.is`.
 */

/** A message the server has acknowledged. */
export type LobbyMessage = ApiLobbyMessage;

/**
 * Something typed here that the server has not confirmed.
 *
 * Kept in its own list rather than mixed in with the confirmed ones, and that
 * is the decision that makes reconciliation trivial: an unconfirmed message
 * has no server id, so it structurally cannot collide with one that does.
 */
export type PendingMessage = {
  clientMessageId: string;
  body: string;
  status: 'pending' | 'failed';
};

export type LobbyState = {
  /** Whether messages are arriving by themselves. */
  connection: LobbyConnectionState | 'idle';
  history: 'idle' | 'loading' | 'ready' | 'error';
  /** Confirmed, ascending by `createdAt` then id. */
  messages: LobbyMessage[];
  /** Always rendered after `messages`. */
  pending: PendingMessage[];
  people: ApiLobbyPerson[];
  /**
   * Account ids currently in the presence set, this browser's included.
   *
   * Ids rather than people: presence carries no name — it deliberately carries
   * nothing at all — so this says who is here and `people` says who they are.
   */
  onlineIds: string[];
  /** Counted from mount, and only while collapsed. See `open()`. */
  unread: number;
  isOpen: boolean;
  error: string | null;
};

const SEND_ERROR = 'That message did not send.';
const LOAD_ERROR = 'We could not load the room.';

function initialState(): LobbyState {
  return {
    connection: 'idle',
    history: 'idle',
    messages: [],
    pending: [],
    people: [],
    onlineIds: [],
    unread: 0,
    // Collapsed on a first visit: 340px is a lot to take from someone who has
    // not asked for it, and the unread badge is a better invitation than a
    // panel they have to close.
    isOpen: storageService.get<boolean>(STORAGE_KEYS.lobbyOpen, false),
    error: null,
  };
}

let state: LobbyState = initialState();

/** The live connection, and how many mounted things are asking for one. */
let connection: LobbyConnection | null = null;
let connecting: Promise<void> | null = null;
let connections = 0;

/** This browser's account, for telling an echo from somebody else's message. */
let selfId: string | null = null;

/**
 * Remembers whether the panel was left open.
 *
 * Swallows a write failure: storage throws in a private window or with cookies
 * blocked, and forgetting where a panel was is not worth taking the room down
 * for.
 */
function remember(isOpen: boolean): void {
  try {
    storageService.set(STORAGE_KEYS.lobbyOpen, isOpen);
  } catch {
    // Nothing to do about it, and nothing lost but a preference.
  }
}

const listeners = new Set<() => void>();

function setState(next: Partial<LobbyState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/* --------------------------------------------------------------- ordering */

/** Ascending by time, id as a stable tiebreak so every client agrees. */
function compare(a: LobbyMessage, b: LobbyMessage): number {
  return a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1;
}

/**
 * Adds a message, or replaces the copy already held.
 *
 * The same message can arrive twice — once as the response to the POST that
 * created it, and once from the realtime channel — and the two are the same
 * row, so whichever lands second must be a no-op rather than a duplicate.
 * Keying on the server id makes both orders produce identical state, which
 * matters because the order is not predictable.
 */
function upsert(messages: LobbyMessage[], incoming: LobbyMessage): LobbyMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);

  if (index !== -1) {
    const next = [...messages];
    next[index] = incoming;

    return next;
  }

  return [...messages, incoming].sort(compare);
}

/* ------------------------------------------------------------------ store */

export const lobbyStore = {
  subscribe,
  getSnapshot: (): LobbyState => state,

  /**
   * Starts listening, and only then asks for the history.
   *
   * That order is the whole point. Backfilling first and subscribing after
   * loses every message published in the gap between the two, silently and
   * unreproducibly — whereas overlapping is free, because a message that
   * arrives twice is reconciled by id.
   *
   * Reference-counted so two mounts share one connection and the second
   * unmount is the one that closes it.
   */
  async connect(): Promise<void> {
    connections += 1;
    if (connection || connecting) return;

    connecting = lobbyChannel
      .connect({
        onMessage: (message) => accept(message, message.userId !== selfId),
        onDelete: (id) => setState({ messages: state.messages.filter((m) => m.id !== id) }),
        onState: (next) => setState({ connection: next }),
        onPresence: (userIds) => arrive(userIds),
      })
      .then((opened) => {
        // Closed again before the socket finished opening.
        if (connections === 0) {
          opened?.close();
          return;
        }

        connection = opened;
      })
      .finally(() => {
        connecting = null;
      });

    await connecting;
  },

  disconnect(): void {
    connections = Math.max(0, connections - 1);
    if (connections > 0) return;

    void connection?.close();
    connection = null;
    // The roster went with the socket. Leaving the last one on screen would
    // show a room full of people to someone who is no longer in it.
    setState({ connection: 'idle', onlineIds: [] });
  },

  /**
   * Who this browser is, so an echo of your own message does not ring a badge.
   *
   * Set by the panel rather than read from the auth store, which would make
   * this module depend on the one that resets it.
   */
  identify(userId: string | null): void {
    selfId = userId;
  },

  /**
   * Loads the conversation.
   *
   * Merged rather than assigned, so anything that arrived while the request
   * was in flight survives — which is what makes it safe to start listening
   * before asking for history rather than after.
   */
  async refresh(): Promise<void> {
    setState({ history: state.history === 'ready' ? 'ready' : 'loading', error: null });

    try {
      const messages = await lobbyService.getMessages();

      setState({
        history: 'ready',
        messages: messages.reduce(upsert, state.messages),
      });
    } catch {
      setState({ history: 'error', error: LOAD_ERROR });
    }
  },

  /**
   * Loads the names.
   *
   * The ids of whoever is present go up with the request: the server's
   * directory is "everyone who has posted", and without them somebody who
   * connected but has not spoken yet would have no name to show.
   */
  async refreshPeople(): Promise<void> {
    try {
      setState({ people: await lobbyService.getPeople(state.onlineIds) });
    } catch {
      // The roster is decoration next to the conversation; failing to load it
      // must not put an error over a room that is working.
    }
  },

  /**
   * Takes a message the room has confirmed.
   *
   * Also retires any local copy of it: the sender drew a bubble before the
   * round trip finished, and this is where that bubble stops being a guess.
   */
  receive(message: LobbyMessage): void {
    accept(message, true);
  },

  /**
   * Says something.
   *
   * The bubble appears immediately, greyed, and is replaced by the real one
   * when the server answers. This is for legibility rather than speed: the
   * API sleeps after fifteen idle minutes and takes about a minute to wake, so
   * without a local echo the reader watches other people's messages arrive
   * while their own does nothing at all.
   */
  async send(body: string): Promise<void> {
    const text = body.trim();
    if (!text) return;

    const clientMessageId = createId('msg');

    setState({
      pending: [...state.pending, { clientMessageId, body: text, status: 'pending' }],
      error: null,
    });

    await deliver(text, clientMessageId);
  },

  /**
   * Sends it again after a failure, under the **same** id.
   *
   * That is what makes this safe: the first attempt may in fact have been
   * written before the answer was lost, and the server keys on this id, so a
   * retry either creates the message or returns the one already there.
   */
  async retry(clientMessageId: string): Promise<void> {
    const entry = state.pending.find((item) => item.clientMessageId === clientMessageId);
    if (!entry) return;

    setState({
      pending: state.pending.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status: 'pending' } : item,
      ),
      error: null,
    });

    await deliver(entry.body, clientMessageId);
  },

  /** Gives up on a failed message. The text is gone only because they said so. */
  discard(clientMessageId: string): void {
    setState({
      pending: state.pending.filter((item) => item.clientMessageId !== clientMessageId),
      error: state.pending.length === 1 ? null : state.error,
    });
  },

  async remove(id: string): Promise<void> {
    const previous = state.messages;

    // Removed first: it is their own message and the outcome is not in doubt
    // often enough to justify watching it linger.
    setState({ messages: previous.filter((message) => message.id !== id) });

    try {
      await lobbyService.deleteMessage(id);
    } catch {
      setState({ messages: previous, error: 'We could not delete that message.' });
    }
  },

  /** Opens the panel, which is also what marks the room read. */
  open(): void {
    remember(true);
    setState({ isOpen: true, unread: 0 });
  },

  close(): void {
    remember(false);
    setState({ isOpen: false });
  },

  toggle(): void {
    if (state.isOpen) lobbyStore.close();
    else lobbyStore.open();
  },

  /**
   * Back to a fresh room.
   *
   * Called when a session ends. The panel keeps no secrets beyond the names
   * and words already on screen, but leaving them there for whoever signs in
   * next on the same browser would be its own kind of wrong.
   */
  reset(): void {
    // The connection carries this account's identity, so it must not outlive
    // the session — the next person to sign in on this browser would inherit
    // a socket introduced as somebody else. `close` leaves the presence set
    // first, so the departing account stops showing as online now rather than
    // whenever Ably times the member out.
    void connection?.close();
    connection = null;
    connections = 0;
    selfId = null;

    state = { ...initialState(), isOpen: state.isOpen };
    listeners.forEach((listener) => listener());
  },
};

/**
 * Files a confirmed message.
 *
 * `countsAsUnread` is false for the reader's own send — a badge telling
 * somebody they have not read the thing they just typed would be absurd.
 */
function accept(message: LobbyMessage, countsAsUnread: boolean): void {
  setState({
    messages: upsert(state.messages, message),
    pending: state.pending.filter((entry) => entry.clientMessageId !== message.clientMessageId),
    unread: countsAsUnread && !state.isOpen ? state.unread + 1 : state.unread,
  });
}

/**
 * Takes a rebuilt roster.
 *
 * Always the whole set, never a delta — see `readPresence` for why a `leave`
 * must not be applied on its own.
 *
 * Fetches names again only when somebody present has none, which is the case
 * that needs it: a person who connects and says nothing is in `onlineIds` and
 * absent from `people`, because the server's directory is everyone who has
 * *posted*. Refetching on every event instead would put a request behind every
 * tab anybody opens or closes.
 */
function arrive(userIds: string[]): void {
  const known = new Set(state.people.map((person) => person.id));
  const stranger = userIds.some((id) => !known.has(id));

  setState({ onlineIds: userIds });

  if (stranger) void lobbyStore.refreshPeople();
}

/** The half of `send`/`retry` they have in common. */
async function deliver(body: string, clientMessageId: string): Promise<void> {
  try {
    accept(await lobbyService.sendMessage(body, clientMessageId), false);
  } catch {
    setState({
      pending: state.pending.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status: 'failed' } : item,
      ),
      error: SEND_ERROR,
    });
  }
}

export function useLobby(): LobbyState {
  return useSyncExternalStore(subscribe, lobbyStore.getSnapshot, lobbyStore.getSnapshot);
}
