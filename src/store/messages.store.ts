import { useSyncExternalStore } from 'react';
import type { ApiConversation, ApiDirectMessage } from '@ai-travel/shared';
import { messagesService } from '../services/messages.service';
import { storageService, STORAGE_KEYS } from '../services/localStorage.service';
import { createId } from '../utils/id';
import * as messagesChannel from './messagesChannel';
import type {
  MessageDeletedEvent,
  MessagesConnection,
  MessagesConnectionState,
} from './messagesChannel';

/**
 * Direct messages: who you can talk to, what has been said to each of them,
 * and what this browser has typed but not yet had acknowledged.
 *
 * Deliberately **not** `createResource`. That models one value fetched and
 * replaced whole; this is a set of append-only feeds where the interesting
 * cases are a message arriving twice by different routes and a message that
 * exists only on this screen so far. Neither fits a single `data` slot.
 *
 * Same hand-rolled shape as `auth.store.ts` — module state, a listener set,
 * one frozen snapshot rebuilt only when something changes. Rebuilding it per
 * read would be an infinite render loop, because `useSyncExternalStore`
 * compares snapshots with `Object.is`.
 *
 * Replaces the store behind the public room, which held one conversation
 * everybody shared. Everything hard about that store was right and is carried
 * over unchanged: the pending list kept apart from the confirmed one, upsert by
 * server id, retry under the same `clientMessageId`, and subscribing before
 * backfilling. What is new is that there are now many conversations rather than
 * one, so all of it is keyed by the person on the other end.
 */

/** A message the server has acknowledged. */
export type DirectMessage = ApiDirectMessage;

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

/** One conversation, as this browser holds it. */
export type Thread = {
  /** Confirmed, ascending by `createdAt` then id. */
  messages: DirectMessage[];
  /** Always rendered after `messages`. */
  pending: PendingMessage[];
  history: 'idle' | 'loading' | 'ready' | 'error';
};

export type MessagesState = {
  /** Whether messages are arriving by themselves. */
  connection: MessagesConnectionState | 'idle';
  /** Everyone who could be talked to, with the state of each conversation. */
  conversations: ApiConversation[];
  /** How the list itself is doing — distinct from how any one thread is doing. */
  directory: 'idle' | 'loading' | 'ready' | 'error';
  /** What the list is filtered by, kept here so a refresh can reapply it. */
  query: string;
  /**
   * Account ids currently in the presence set, this browser's included.
   *
   * Ids rather than people: presence carries no name — it deliberately carries
   * nothing at all — so this says who is here and `conversations` says who
   * they are.
   */
  onlineIds: string[];
  /** Whose conversation is on screen, or null when none has been picked. */
  activeUserId: string | null;
  /**
   * Threads by the id of the person on the other end.
   *
   * Keyed that way rather than by a conversation id because that is what every
   * arrival already carries, and it is what makes an inbound message cheap: it
   * lands in its own thread whether or not that thread is the one being looked
   * at.
   */
  threads: Record<string, Thread>;
  isOpen: boolean;
  error: string | null;
};

const SEND_ERROR = 'That message did not send.';
const LOAD_ERROR = 'We could not load that conversation.';
const DELETE_ERROR = 'We could not delete that message.';

/**
 * The thread of somebody who has none yet.
 *
 * One frozen instance rather than a fresh object per read: a component asking
 * for a conversation nobody has opened must get the same object every time, or
 * it re-renders forever.
 */
const EMPTY_THREAD: Thread = Object.freeze({
  messages: [] as DirectMessage[],
  pending: [] as PendingMessage[],
  history: 'idle' as const,
});

function initialState(): MessagesState {
  return {
    connection: 'idle',
    conversations: [],
    directory: 'idle',
    query: '',
    onlineIds: [],
    activeUserId: null,
    threads: {},
    // Collapsed on a first visit: 600px is a lot to take from someone who has
    // not asked for it, and the unread badge is a better invitation than a
    // panel they have to close.
    isOpen: storageService.get<boolean>(STORAGE_KEYS.messagesOpen, false),
    error: null,
  };
}

let state: MessagesState = initialState();

/** The live connection, and how many mounted things are asking for one. */
let connection: MessagesConnection | null = null;
let connecting: Promise<void> | null = null;
let connections = 0;

/**
 * This browser's account.
 *
 * Load-bearing in a way it was not in the public room: it names the channel to
 * listen on, and it is how an arriving message is sorted into a thread — the
 * other end is whichever of the two ids is not this one.
 */
let selfId: string | null = null;

/**
 * Remembers whether the panel was left open.
 *
 * Swallows a write failure: storage throws in a private window or with cookies
 * blocked, and forgetting where a panel was is not worth taking messages down
 * for.
 */
function remember(isOpen: boolean): void {
  try {
    storageService.set(STORAGE_KEYS.messagesOpen, isOpen);
  } catch {
    // Nothing to do about it, and nothing lost but a preference.
  }
}

const listeners = new Set<() => void>();

function setState(next: Partial<MessagesState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/* --------------------------------------------------------------- threads */

/**
 * One conversation, whether or not it has been started.
 *
 * The reason nothing has to check for a missing key: a person with no messages
 * is an empty thread, not an absent one.
 */
export function threadFor(snapshot: MessagesState, userId: string | null): Thread {
  if (!userId) return EMPTY_THREAD;

  return snapshot.threads[userId] ?? EMPTY_THREAD;
}

/** Writes one thread back, leaving every other alone. */
function patchThread(userId: string, patch: Partial<Thread>): void {
  const current = state.threads[userId] ?? EMPTY_THREAD;

  setState({ threads: { ...state.threads, [userId]: { ...current, ...patch } } });
}

/**
 * Which conversation a message belongs to.
 *
 * Every message arrives on this account's own inbox channel — including the
 * reader's own sends, which is how their other tabs see what they wrote — so
 * the thread is named by whichever end is not them.
 */
function otherEndOf(message: { senderId: string; recipientId: string }): string {
  return message.senderId === selfId ? message.recipientId : message.senderId;
}

/* --------------------------------------------------------------- ordering */

/** Ascending by time, id as a stable tiebreak so every client agrees. */
function compare(a: DirectMessage, b: DirectMessage): number {
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
function upsert(messages: DirectMessage[], incoming: DirectMessage): DirectMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);

  if (index !== -1) {
    const next = [...messages];
    next[index] = incoming;

    return next;
  }

  return [...messages, incoming].sort(compare);
}

/* ------------------------------------------------------------------ store */

export const messagesStore = {
  subscribe,
  getSnapshot: (): MessagesState => state,

  /**
   * Starts listening.
   *
   * Nothing is fetched here. The panel mounts on every page for every signed-in
   * reader and most never open it, so the list and each thread are fetched when
   * somebody actually looks — but the socket is opened regardless, because a
   * collapsed panel still has to say how much has been missed.
   *
   * Reference-counted so two mounts share one connection and the second unmount
   * is the one that closes it.
   */
  async connect(): Promise<void> {
    connections += 1;
    if (connection || connecting) return;

    // Nobody to be. `identify` runs first from the same effect that calls this;
    // without an id there is no inbox channel to name.
    if (!selfId) return;

    const userId = selfId;

    connecting = messagesChannel
      .connect(userId, {
        onMessage: (message) => accept(message),
        onShare: (message) => applyShare(message),
        onDelete: (event) => withdraw(event),
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
    // Presence went with the socket. Leaving the last set on screen would show
    // a list of people as live to somebody who can no longer see them.
    setState({ connection: 'idle', onlineIds: [] });
  },

  /**
   * Who this browser is.
   *
   * Set by the panel rather than read from the auth store, which would make
   * this module depend on the one that resets it.
   */
  identify(userId: string | null): void {
    selfId = userId;
  },

  /**
   * Loads the people list.
   *
   * `query` is remembered so that a refresh triggered by something other than
   * typing — somebody coming online, an unknown person writing to you — does
   * not silently widen a filtered list back out.
   */
  async refreshConversations(query?: string): Promise<void> {
    const q = query ?? state.query;

    setState({
      directory: state.directory === 'ready' && q === state.query ? 'ready' : 'loading',
      query: q,
    });

    try {
      const conversations = await messagesService.getConversations(q || undefined);

      // Dropped if the filter moved on while this was in flight, so a slow
      // answer to an old query cannot overwrite a newer list.
      if (q !== state.query) return;

      setState({ directory: 'ready', conversations });
    } catch {
      setState({ directory: 'error' });
    }
  },

  /**
   * Puts one conversation on screen.
   *
   * Loads it the first time only: after that, messages arrive by themselves and
   * a second backfill would ask for what is already held. Opening is also what
   * marks it read — that is the entire meaning of the badge.
   */
  async openThread(userId: string): Promise<void> {
    setState({ activeUserId: userId, error: null });

    const existing = state.threads[userId];

    if (!existing || existing.history === 'idle' || existing.history === 'error') {
      await messagesStore.refreshThread(userId);
    }

    await messagesStore.markRead(userId);
  },

  /** Backs out to the list, which is what the phone's back arrow does. */
  closeThread(): void {
    setState({ activeUserId: null });
  },

  /**
   * Loads a conversation.
   *
   * Merged rather than assigned, so anything that arrived while the request was
   * in flight survives — which is what makes it safe to start listening before
   * asking for history rather than after.
   */
  async refreshThread(userId: string): Promise<void> {
    const current = state.threads[userId] ?? EMPTY_THREAD;

    patchThread(userId, { history: current.history === 'ready' ? 'ready' : 'loading' });

    try {
      const messages = await messagesService.getThread(userId);
      const held = (state.threads[userId] ?? EMPTY_THREAD).messages;

      patchThread(userId, { history: 'ready', messages: messages.reduce(upsert, held) });
    } catch {
      patchThread(userId, { history: 'error' });
      setState({ error: LOAD_ERROR });
    }
  },

  /**
   * Marks a conversation read, here and on the server.
   *
   * Both halves matter. The server's cursor is what survives a reload and what
   * clears the badge on the reader's other devices; the local zero is what
   * stops the count sitting there until the list is next fetched.
   */
  async markRead(userId: string): Promise<void> {
    setState({ conversations: withUnread(state.conversations, userId, 0) });

    try {
      await messagesService.markRead(userId);
    } catch {
      // A cursor that failed to move is a badge that comes back, which is a
      // great deal better than an error over a conversation that is working.
    }
  },

  /**
   * Takes a card that has changed — accepted, or withdrawn.
   *
   * Public so the reader's own accept can patch their screen without waiting
   * for the round trip to come back over the channel, and so a browser with no
   * realtime at all still updates the card it just acted on.
   */
  applyShare(message: DirectMessage): void {
    applyShare(message);
  },

  /**
   * Marks a card taken up, here and now.
   *
   * The authoritative version arrives over the channel a moment later and
   * upserts over this — but the card has to change under the finger that
   * pressed it, and a browser whose realtime is down still has to show what it
   * just did.
   */
  noteShareAccepted(shareId: string): void {
    patchShare(shareId, { acceptedAt: new Date().toISOString() });
  },

  /** The same, for an offer the sender has withdrawn. */
  noteShareRevoked(shareId: string): void {
    patchShare(shareId, { revokedAt: new Date().toISOString() });
  },

  /**
   * Takes a message the server has confirmed.
   *
   * Also retires any local copy of it: the sender drew a bubble before the
   * round trip finished, and this is where that bubble stops being a guess.
   */
  receive(message: DirectMessage): void {
    accept(message);
  },

  /**
   * Says something to one person.
   *
   * The bubble appears immediately, greyed, and is replaced by the real one
   * when the server answers. This is for legibility rather than speed: the API
   * sleeps after fifteen idle minutes and takes about a minute to wake, so
   * without a local echo the reader watches the other person's messages arrive
   * while their own does nothing at all.
   */
  async send(userId: string, body: string): Promise<void> {
    const text = body.trim();
    if (!text) return;

    const clientMessageId = createId('msg');
    const thread = state.threads[userId] ?? EMPTY_THREAD;

    patchThread(userId, {
      pending: [...thread.pending, { clientMessageId, body: text, status: 'pending' }],
    });
    setState({ error: null });

    await deliver(userId, text, clientMessageId);
  },

  /**
   * Sends it again after a failure, under the **same** id.
   *
   * That is what makes this safe: the first attempt may in fact have been
   * written before the answer was lost, and the server keys on this id, so a
   * retry either creates the message or returns the one already there.
   */
  async retry(userId: string, clientMessageId: string): Promise<void> {
    const thread = state.threads[userId] ?? EMPTY_THREAD;
    const entry = thread.pending.find((item) => item.clientMessageId === clientMessageId);
    if (!entry) return;

    patchThread(userId, {
      pending: thread.pending.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status: 'pending' } : item,
      ),
    });
    setState({ error: null });

    await deliver(userId, entry.body, clientMessageId);
  },

  /** Gives up on a failed message. The text is gone only because they said so. */
  discard(userId: string, clientMessageId: string): void {
    const thread = state.threads[userId] ?? EMPTY_THREAD;

    patchThread(userId, {
      pending: thread.pending.filter((item) => item.clientMessageId !== clientMessageId),
    });
    setState({ error: thread.pending.length === 1 ? null : state.error });
  },

  /**
   * Withdraws one of your own messages.
   *
   * Taken off screen first: it is their own message and the outcome is not in
   * doubt often enough to justify watching it linger. Put back if the server
   * disagrees.
   */
  async remove(userId: string, id: string): Promise<void> {
    const previous = (state.threads[userId] ?? EMPTY_THREAD).messages;

    patchThread(userId, { messages: previous.filter((message) => message.id !== id) });

    try {
      await messagesService.deleteMessage(id);
    } catch {
      patchThread(userId, { messages: previous });
      setState({ error: DELETE_ERROR });
    }
  },

  /** Opens the panel. */
  open(): void {
    remember(true);
    setState({ isOpen: true });
  },

  close(): void {
    remember(false);
    setState({ isOpen: false });
  },

  toggle(): void {
    if (state.isOpen) messagesStore.close();
    else messagesStore.open();
  },

  /**
   * Back to nothing.
   *
   * Called when a session ends. Private conversations are exactly the thing
   * that must not still be on screen for whoever signs in next on this browser.
   */
  reset(): void {
    // The connection carries this account's identity — it is attached to this
    // account's inbox — so it must not outlive the session. `close` leaves the
    // presence set first, so the departing account stops showing as online now
    // rather than whenever Ably times the member out.
    void connection?.close();
    connection = null;
    connections = 0;
    selfId = null;

    state = { ...initialState(), isOpen: state.isOpen };
    listeners.forEach((listener) => listener());
  },
};

/* ------------------------------------------------------------- internals */

/** Sets one person's unread count, leaving the rest of the list alone. */
function withUnread(
  conversations: ApiConversation[],
  userId: string,
  unread: number,
): ApiConversation[] {
  return conversations.map((conversation) =>
    conversation.id === userId ? { ...conversation, unread } : conversation,
  );
}

/**
 * Files a confirmed message in the thread it belongs to.
 *
 * The three things that happen here are the whole reconciliation story: the
 * message is upserted by server id so a response and a realtime copy of the
 * same row collapse into one; the optimistic bubble carrying its
 * `clientMessageId` is retired; and the list entry is updated so the preview
 * and the unread count do not wait for the next fetch.
 */
function accept(message: DirectMessage): void {
  const userId = otherEndOf(message);
  const thread = state.threads[userId] ?? EMPTY_THREAD;

  patchThread(userId, {
    messages: upsert(thread.messages, message),
    pending: thread.pending.filter((entry) => entry.clientMessageId !== message.clientMessageId),
  });

  note(message, userId);
}

/**
 * Keeps the people list honest about a message that just landed.
 *
 * The preview moves for anything, in either direction. The unread count only
 * moves for somebody else's message, and only when the reader is not sitting in
 * that conversation with the panel open — a badge telling somebody they have
 * not read what is on their screen would be absurd, and so would one for what
 * they just typed themselves.
 *
 * When the sender is not in the list at all, the list is refetched: it is
 * somebody who signed up since it was last loaded, and their message must not
 * arrive from a person with no name.
 */
function note(message: DirectMessage, userId: string): void {
  const fromThem = message.senderId !== selfId;
  const watching = state.isOpen && state.activeUserId === userId;
  const known = state.conversations.some((conversation) => conversation.id === userId);

  if (!known) {
    if (fromThem) void messagesStore.refreshConversations();

    return;
  }

  setState({
    conversations: state.conversations.map((conversation) =>
      conversation.id === userId
        ? {
            ...conversation,
            lastMessage: {
              body: message.body,
              createdAt: message.createdAt,
              isMine: !fromThem,
            },
            unread: fromThem
              ? watching
                ? 0
                : conversation.unread + 1
              : conversation.unread,
          }
        : conversation,
    ),
  });

  // Read as it arrives, so the badge does not come back on the next reload for
  // messages the reader watched land.
  if (fromThem && watching) void messagesService.markRead(userId).catch(() => {});
}

/**
 * Replaces a message whose card has changed.
 *
 * Deliberately not `accept`: nothing new was said. Bumping the unread count or
 * moving the conversation's preview because a card went from "Waiting" to
 * "Added" would tell the reader there is something to read when there is not.
 * The message upserts by id, so the card is the only thing that moves.
 */
function applyShare(message: DirectMessage): void {
  const userId = otherEndOf(message);
  const thread = state.threads[userId];

  // Nothing held for this person yet: the card will arrive with the thread
  // when it is opened, already in its current state.
  if (!thread) return;

  patchThread(userId, { messages: upsert(thread.messages, message) });
}

/**
 * Changes one card wherever it is being held.
 *
 * Searched for rather than addressed, because a share knows which thread it is
 * in and the caller does not: the card was pressed, not the conversation.
 */
function patchShare(shareId: string, patch: { acceptedAt?: string; revokedAt?: string }): void {
  const threads = { ...state.threads };
  let changed = false;

  for (const [userId, thread] of Object.entries(state.threads)) {
    const messages = thread.messages.map((message) =>
      message.share?.id === shareId
        ? { ...message, share: { ...message.share, ...patch } }
        : message,
    );

    if (messages.some((message, index) => message !== thread.messages[index])) {
      threads[userId] = { ...thread, messages };
      changed = true;
    }
  }

  if (changed) setState({ threads });
}

/**
 * Takes a withdrawn message off screen, in whichever thread it was in.
 *
 * The event names both ends because it goes to both of them; this is the side
 * that works out which of them is the other person.
 */
function withdraw(event: MessageDeletedEvent): void {
  const userId = otherEndOf(event);
  const thread = state.threads[userId];
  if (!thread) return;

  patchThread(userId, {
    messages: thread.messages.filter((message) => message.id !== event.id),
  });
}

/**
 * Takes a rebuilt roster.
 *
 * Always the whole set, never a delta — see `readPresence` for why a `leave`
 * must not be applied on its own.
 *
 * The list is fetched again when the set actually changes, and only while
 * somebody is looking. Both halves matter:
 *
 * - **Only while open.** The panel mounts on every page for every signed-in
 *   reader and most never open it; fetching on connect would put a query behind
 *   every page load.
 * - **Because presence and names arrive by different routes.** Presence says an
 *   id is here; only the list says who that is. Somebody who signed up since
 *   the list was last loaded is otherwise a live dot with no row.
 *
 * Comparing the sets rather than refetching per event is what keeps a second
 * tab from the same person — which fires an event and changes nothing — from
 * costing a request.
 */
function arrive(userIds: string[]): void {
  const changed =
    userIds.length !== state.onlineIds.length ||
    userIds.some((id) => !state.onlineIds.includes(id));

  setState({ onlineIds: userIds });

  if (changed && state.isOpen) void messagesStore.refreshConversations();
}

/** The half of `send` and `retry` they have in common. */
async function deliver(userId: string, body: string, clientMessageId: string): Promise<void> {
  try {
    accept(await messagesService.sendMessage(userId, body, clientMessageId));
  } catch {
    const thread = state.threads[userId] ?? EMPTY_THREAD;

    patchThread(userId, {
      pending: thread.pending.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status: 'failed' } : item,
      ),
    });
    setState({ error: SEND_ERROR });
  }
}

export function useMessages(): MessagesState {
  return useSyncExternalStore(subscribe, messagesStore.getSnapshot, messagesStore.getSnapshot);
}
