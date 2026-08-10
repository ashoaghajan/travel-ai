import type { Activity } from '../types/travel.types';
import { http } from './http';

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
 * Persisted through `/api/saved-activities`. The 200-row cap moved to the
 * server with the list: it was client-enforced, so a second device grew the
 * shortlist straight past it.
 *
 * `toggle` has gone. It read the current state synchronously to decide which
 * way to go, which is not something a fetched list can answer — the store
 * makes that decision now, from the list it is already holding.
 */

export type SavedActivity = {
  activity: Activity;
  /** ISO timestamp of when it was saved. */
  savedAt: string;
};

export const savedActivityService = {
  /** Newest first. */
  async getSaved(): Promise<SavedActivity[]> {
    return http.get<SavedActivity[]>('/saved-activities');
  },

  /**
   * Saves an attraction, or refreshes the copy already held.
   *
   * Re-saving moves it to the top and updates the stored card, so a place
   * saved before its photograph resolved picks the photograph up. The endpoint
   * answers with the whole shortlist, so the caller replaces what it holds
   * rather than merging towards it.
   */
  async save(activity: Activity): Promise<SavedActivity[]> {
    return http.put<SavedActivity[]>(
      `/saved-activities/${encodeURIComponent(activity.id)}`,
      { activity },
    );
  },

  async remove(activityId: string): Promise<SavedActivity[]> {
    return http.delete<SavedActivity[]>(`/saved-activities/${encodeURIComponent(activityId)}`);
  },

  async clear(): Promise<void> {
    await http.delete<void>('/saved-activities');
  },
};
