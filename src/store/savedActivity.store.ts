import { useSyncExternalStore } from 'react';
import type { Activity } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from '../services/localStorage.service';
import { readSavedSync, savedActivityService } from '../services/savedActivity.service';
import type { SavedActivity } from '../services/savedActivity.service';

/**
 * Shared read model for saved attractions.
 *
 * Components read through `useSavedActivities()` / `useIsActivitySaved()` and
 * write through `savedActivityStore`. The cache refreshes from the storage
 * subscription, so a save made anywhere — the card, the details page, another
 * tab — reaches every subscriber at once.
 */

let cache: SavedActivity[] = readSavedSync();
const listeners = new Set<() => void>();

storageService.subscribe(STORAGE_KEYS.savedActivities, () => {
  cache = readSavedSync();
  listeners.forEach((listener) => listener());
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable reference between changes — required by `useSyncExternalStore`. */
function getSnapshot(): SavedActivity[] {
  return cache;
}

export const savedActivityStore = {
  subscribe,
  getSnapshot,

  async save(activity: Activity): Promise<void> {
    await savedActivityService.save(activity);
  },

  async remove(activityId: string): Promise<void> {
    await savedActivityService.remove(activityId);
  },

  /** Returns whether the attraction is saved after the toggle. */
  async toggle(activity: Activity): Promise<boolean> {
    return savedActivityService.toggle(activity);
  },
};

/** Saved attractions, newest first. */
export function useSavedActivities(): SavedActivity[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Whether one attraction is saved, kept in step with every other view of it. */
export function useIsActivitySaved(activityId: string | undefined): boolean {
  const saved = useSavedActivities();
  return activityId ? saved.some((entry) => entry.activity.id === activityId) : false;
}
