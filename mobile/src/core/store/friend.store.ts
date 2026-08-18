import { useSyncExternalStore } from 'react';
import type { ApiFriend, ApiFriendRequests, ApiFriendStats } from '@ai-travel/shared';
import { friendService } from '../services/friend.service';
import { createResource } from './createResource';
import { broadcast, onBroadcast } from './broadcast';

/**
 * Who the reader may talk to, and who is waiting on an answer.
 *
 * `createResource` fits here where it did not fit messages: these are three
 * lists fetched and replaced whole, with no notion of an unconfirmed item and
 * nothing arriving by itself. Every mutation goes to the server and then
 * refetches, rather than merging a guess — a friendship is a fact about two
 * accounts, and the other end may have changed it in the meantime.
 *
 * Three resources rather than one, because three screens want different parts
 * and the counts are wanted by a screen that needs neither list: the profile
 * reads `stats` without ever loading a name.
 */

const NO_FRIENDS: ApiFriend[] = [];
const NO_REQUESTS: ApiFriendRequests = { incoming: [], outgoing: [] };
const NO_STATS: ApiFriendStats = { friends: 0, incoming: 0, outgoing: 0, totalUsers: 0 };

const friendsResource = createResource<ApiFriend[]>({
  empty: NO_FRIENDS,
  load: () => friendService.getFriends(),
});

const requestsResource = createResource<ApiFriendRequests>({
  empty: NO_REQUESTS,
  load: () => friendService.getRequests(),
});

const statsResource = createResource<ApiFriendStats>({
  empty: NO_STATS,
  load: () => friendService.getStats(),
});

/**
 * Another tab answered a request.
 *
 * Refetched rather than trusting a payload, as the trip store does: the two
 * tabs can be looking at different moments of the same pair.
 */
onBroadcast('friends', () => void refreshAll());

async function refreshAll(): Promise<void> {
  await Promise.all([
    friendsResource.refresh(),
    requestsResource.refresh(),
    statsResource.refresh(),
  ]);
}

/**
 * Everything this store holds is derived from the same table, so any change to
 * it changes all three: accepting moves a row out of `requests` into `friends`
 * and moves two numbers. Refetching all three is one round trip more than the
 * minimum and one source of truth fewer.
 */
async function mutate(action: () => Promise<unknown>): Promise<void> {
  await action();
  await refreshAll();
  broadcast('friends');
}

export const friendStore = {
  subscribe: friendsResource.subscribe,
  getSnapshot: friendsResource.getSnapshot,

  refresh: refreshAll,

  /** Just the counts, for the profile — which wants numbers and no names. */
  refreshStats: () => statsResource.refresh(),

  /** Asks — or accepts, when they asked first. The server decides which. */
  async add(userId: string): Promise<void> {
    await mutate(() => friendService.addFriend(userId));
  },

  async accept(userId: string): Promise<void> {
    await mutate(() => friendService.acceptFriend(userId));
  },

  /** Cancel, decline, unfriend: one call for one fact. */
  async remove(userId: string): Promise<void> {
    await mutate(() => friendService.removeFriend(userId));
  },

  /**
   * Back to nothing.
   *
   * For sign-out: who somebody's friends are is exactly the sort of thing the
   * next reader on this browser must not find already on screen.
   */
  reset(): void {
    friendsResource.reset();
    requestsResource.reset();
    statsResource.reset();
  },
};

/** The reader's friends, alphabetically. */
export function useFriends(): ApiFriend[] {
  return useSyncExternalStore(
    friendsResource.subscribe,
    () => friendsResource.getSnapshot().data,
    () => friendsResource.getSnapshot().data,
  );
}

/** The list plus whether it has arrived — for telling "none" from "not yet". */
export function useFriendsResource() {
  return useSyncExternalStore(
    friendsResource.subscribe,
    friendsResource.getSnapshot,
    friendsResource.getSnapshot,
  );
}

export function useFriendRequests(): ApiFriendRequests {
  return useSyncExternalStore(
    requestsResource.subscribe,
    () => requestsResource.getSnapshot().data,
    () => requestsResource.getSnapshot().data,
  );
}

export function useFriendStats(): ApiFriendStats {
  return useSyncExternalStore(
    statsResource.subscribe,
    () => statsResource.getSnapshot().data,
    () => statsResource.getSnapshot().data,
  );
}
