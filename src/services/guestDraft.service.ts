import type { TripDraft } from '../types/trip.types';

const KEY = 'ai-travel-planner:guest-draft';

/** Short-lived handoff from the public planner into an account. */
export const guestDraftService = {
  save(draft: TripDraft): void {
    localStorage.setItem(KEY, JSON.stringify(draft));
  },

  get(): TripDraft | null {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (
        !value ||
        typeof value !== 'object' ||
        !('title' in value) ||
        typeof value.title !== 'string' ||
        !('destination' in value) ||
        typeof value.destination !== 'string' ||
        !('itinerary' in value) ||
        !Array.isArray(value.itinerary)
      ) {
        return null;
      }

      return value as TripDraft;
    } catch {
      return null;
    }
  },

  clear(): void {
    localStorage.removeItem(KEY);
  },
};
