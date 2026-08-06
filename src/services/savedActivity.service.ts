import type { Activity } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Attractions the reader bookmarked from the explorer.
 *
 * The whole `Activity` is stored, not just its id. The explorer's own cache
 * expires after five minutes and is keyed to one city at a time, so an id
 * alone would leave a saved item unrenderable the moment the reader looked at
 * somewhere else — the list would need a network round trip per row to draw
 * itself. A saved card is small, and copying it makes the list work offline
 * and instantly.
 *
 * Async like the other domain services, so Stage 2 can move it behind
 * `GET /api/saved-activities` without changing a caller.
 */

/** Newest first, and bounded — this is a shortlist, not an archive. */
const MAX_SAVED = 200;

export type SavedActivity = {
  activity: Activity;
  /** ISO timestamp of when it was saved. */
  savedAt: string;
};

function isSavedActivity(value: unknown): value is SavedActivity {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<SavedActivity>;
  return (
    typeof candidate.savedAt === 'string' &&
    typeof candidate.activity === 'object' &&
    candidate.activity !== null &&
    typeof candidate.activity.id === 'string' &&
    typeof candidate.activity.title === 'string'
  );
}

function read(): SavedActivity[] {
  const stored = storageService.get<unknown>(STORAGE_KEYS.savedActivities, []);
  if (!Array.isArray(stored)) return [];

  // A hand-edited or half-written entry drops out rather than crashing the list.
  return stored.filter(isSavedActivity);
}

function write(saved: SavedActivity[]): void {
  storageService.set(STORAGE_KEYS.savedActivities, saved.slice(0, MAX_SAVED));
}

export const savedActivityService = {
  /** Newest first. */
  async getSaved(): Promise<SavedActivity[]> {
    return read();
  },

  /**
   * Saves an attraction, or refreshes the copy already held.
   *
   * Re-saving moves it to the top and updates the stored card, so a place
   * saved before its photograph resolved picks the photograph up.
   */
  async save(activity: Activity): Promise<SavedActivity[]> {
    const rest = read().filter((entry) => entry.activity.id !== activity.id);
    const next = [{ activity, savedAt: new Date().toISOString() }, ...rest];

    write(next);
    return next.slice(0, MAX_SAVED);
  },

  async remove(activityId: string): Promise<SavedActivity[]> {
    const next = read().filter((entry) => entry.activity.id !== activityId);

    write(next);
    return next;
  },

  /** Saves if absent, removes if present. Returns whether it is now saved. */
  async toggle(activity: Activity): Promise<boolean> {
    if (readIsSaved(activity.id)) {
      await savedActivityService.remove(activity.id);
      return false;
    }

    await savedActivityService.save(activity);
    return true;
  },

  async clear(): Promise<void> {
    storageService.remove(STORAGE_KEYS.savedActivities);
  },
};

/**
 * Synchronous reads, used only by the store so subscribers paint the stored
 * state on the first render — the same split `trip.service` uses.
 */
export function readSavedSync(): SavedActivity[] {
  return read();
}

export function readIsSaved(activityId: string): boolean {
  return read().some((entry) => entry.activity.id === activityId);
}
