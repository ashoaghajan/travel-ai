import { useSyncExternalStore } from 'react';
import type { Activity } from '../types/travel.types';
import { savedActivityService } from '../services/savedActivity.service';
import type { SavedActivity } from '../services/savedActivity.service';
import { createResource } from './createResource';
import type { ResourceSnapshot } from './createResource';
import { broadcast, onBroadcast } from './broadcast';

/**
 * Shared read model for saved attractions.
 *
 * Components read through `useSavedActivities()` / `useIsActivitySaved()` and
 * write through `savedActivityStore`. Every write replaces the list with the
 * one the server answered with, so the shortlist on screen is the shortlist
 * that exists — including the server's own cap, which the client cannot
 * predict.
 */

/** Module-level so the identity is stable — see `createResource`. */
const EMPTY_SAVED: SavedActivity[] = [];

const saved = createResource<SavedActivity[]>({
  empty: EMPTY_SAVED,
  load: () => savedActivityService.getSaved(),
});

onBroadcast('savedActivities', () => {
  void saved.refresh();
});

const select = (): SavedActivity[] => saved.getSnapshot().data;

export const savedActivityStore = {
  subscribe: saved.subscribe,
  getSnapshot: saved.getSnapshot,

  async save(activity: Activity): Promise<void> {
    saved.set(await savedActivityService.save(activity));
    broadcast('savedActivities');
  },

  async remove(activityId: string): Promise<void> {
    saved.set(await savedActivityService.remove(activityId));
    broadcast('savedActivities');
  },

  /**
   * Saves if absent, removes if present. Returns whether it is now saved.
   *
   * The decision is made here, from the list already in hand. It used to be
   * made in the service by reading storage synchronously, which is not a
   * question a fetched list can answer without a round trip nobody needs.
   */
  async toggle(activity: Activity): Promise<boolean> {
    const isSaved = select().some((entry) => entry.activity.id === activity.id);

    if (isSaved) {
      await savedActivityStore.remove(activity.id);
      return false;
    }

    await savedActivityStore.save(activity);
    return true;
  },

  /** Refetch — after a sign-in, or after the local-data import. */
  async refresh(): Promise<void> {
    await saved.refresh();
  },

  /** Sign-out: the next reader must not see this account's shortlist. */
  reset(): void {
    saved.reset();
  },
};

/** Saved attractions, newest first. */
export function useSavedActivities(): SavedActivity[] {
  return useSyncExternalStore(saved.subscribe, select, select);
}

/**
 * The list plus whether it has arrived.
 *
 * `ActivityDetailsPage` needs this: the heart icon reads "unsaved" while the
 * list is still in flight, which is a claim rather than a blank.
 */
export function useSavedActivitiesResource(): ResourceSnapshot<SavedActivity[]> {
  return useSyncExternalStore(saved.subscribe, saved.getSnapshot, saved.getSnapshot);
}

/** Whether one attraction is saved, kept in step with every other view of it. */
export function useIsActivitySaved(activityId: string | undefined): boolean {
  const list = useSavedActivities();

  return activityId ? list.some((entry) => entry.activity.id === activityId) : false;
}
