import { ERROR_CODES } from '@ai-travel/shared';
import type { ApiUser } from '@ai-travel/shared';
import type { ItineraryActivity, Trip, TripDraft, TripPatch } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import { createId } from '../utils/id';
import { ApiError, http } from './http';

/**
 * Trip persistence.
 *
 * Every method now goes to `/api/trips`, and every signature is the one it had
 * when this read `localStorage` — which is why the swap touched no caller. The
 * error classes below are part of that contract: components branch on them, so
 * an API failure is turned back into the type they expect rather than an
 * `ApiError` they have never heard of.
 *
 * No React component may import this file.
 */

export class TripNotFoundError extends Error {
  constructor(id: string) {
    super(`No trip with id "${id}".`);
    this.name = 'TripNotFoundError';
  }
}

export class ItineraryDayNotFoundError extends Error {
  constructor(dayId: string) {
    super(`No day with id "${dayId}" on this trip.`);
    this.name = 'ItineraryDayNotFoundError';
  }
}

export class ActivityAlreadyOnDayError extends Error {
  constructor(title: string) {
    super(`"${title}" is already planned for this day.`);
    this.name = 'ActivityAlreadyOnDayError';
  }
}

/**
 * The trip changed underneath this edit.
 *
 * New with the API, because the situation is: two tabs open on one trip both
 * read version 3, and without this the slower write wins silently and the
 * other person's changes are gone with nothing to show for it.
 */
export class StaleTripError extends Error {
  constructor() {
    super('This trip changed somewhere else while you were editing it.');
    this.name = 'StaleTripError';
  }
}

/**
 * Turns an API failure back into the error the callers branch on.
 *
 * Every trip failure the server can report has a code of its own, so this is a
 * lookup rather than status-sniffing. Anything unrecognised is rethrown
 * untouched — a dead network or a 500 is not a trip problem, and dressing one
 * as `TripNotFoundError` would tell someone their trip was deleted because the
 * server restarted.
 */
function rethrowTripError(
  error: unknown,
  context: { tripId?: string; dayId?: string; title?: string },
): never {
  if (error instanceof ApiError) {
    if (error.code === ERROR_CODES.TRIP_NOT_FOUND) {
      throw new TripNotFoundError(context.tripId ?? '');
    }
    if (error.code === ERROR_CODES.DAY_NOT_FOUND) {
      throw new ItineraryDayNotFoundError(context.dayId ?? '');
    }
    if (error.code === ERROR_CODES.ACTIVITY_ALREADY_ON_DAY) {
      throw new ActivityAlreadyOnDayError(context.title ?? 'That attraction');
    }
    if (error.code === ERROR_CODES.STALE_TRIP) throw new StaleTripError();
  }

  throw error;
}

/**
 * Sorts "09:30" before "14:00"; anything unparseable sinks to the end.
 *
 * Still client-side, because the itinerary editor places a picked attraction
 * by this rule before anything is saved. The server has its own copy for the
 * import endpoint — one is UX, the other is the record.
 */
export function minutesOf(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;

  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Turns an explorer attraction into an itinerary entry.
 *
 * `sourceActivityId` is what makes the import traceable — it is how the day
 * knows this came from the explorer, and how a second import of the same place
 * is recognised as a duplicate.
 */
export function toItineraryActivity(activity: Activity, time: string): ItineraryActivity {
  return {
    id: createId('act'),
    time,
    title: activity.title,
    description: activity.description,
    category: activity.category,
    priceEstimate: activity.price > 0 ? activity.price : undefined,
    image: activity.image,
    sourceActivityId: activity.id,
    coordinates: activity.coordinates,
  };
}

export const tripService = {
  /** Newest first. */
  async getTrips(): Promise<Trip[]> {
    return http.get<Trip[]>('/trips');
  },

  /**
   * One trip, or `undefined`.
   *
   * Undefined rather than a throw for a missing trip: that is what this has
   * always returned, and `useTripDetails` reads it as `notFound`.
   */
  async getTripById(id: string): Promise<Trip | undefined> {
    try {
      return await http.get<Trip>(`/trips/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === ERROR_CODES.TRIP_NOT_FOUND) return undefined;

      throw error;
    }
  },

  /**
   * Saves a generated draft.
   *
   * Idempotent by `draftId`, now enforced by a unique constraint rather than a
   * scan of the list: saving the same itinerary twice — a double click, a
   * second tab, or the same conversation after a reload — returns the trip
   * that already exists instead of creating a duplicate.
   */
  async createTrip(draft: TripDraft): Promise<Trip> {
    return http.post<Trip>('/trips', draft);
  },

  /** Edits persist immediately and bump `updatedAt`. */
  async updateTrip(id: string, patch: TripPatch): Promise<Trip> {
    try {
      return await http.patch<Trip>(`/trips/${encodeURIComponent(id)}`, patch);
    } catch (error) {
      return rethrowTripError(error, { tripId: id });
    }
  },

  /**
   * Adds an attraction from the explorer to one day of a trip.
   *
   * The ordering and duplicate rules run server-side now, inside a row-locked
   * transaction: the day stays in time order so an import lands where it
   * belongs, and re-adding the same place is refused rather than silently
   * duplicated.
   */
  async addActivityToDay(
    tripId: string,
    dayId: string,
    activity: Activity,
    options: { time?: string } = {},
  ): Promise<Trip> {
    try {
      return await http.post<Trip>(
        `/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(dayId)}/activities`,
        {
          // Named rather than spread: `Activity` carries display-only fields —
          // rating, reviews, credits — that the itinerary has no use for.
          activity: {
            id: activity.id,
            title: activity.title,
            description: activity.description,
            category: activity.category,
            price: activity.price,
            image: activity.image,
            coordinates: activity.coordinates,
          },
          time: options.time?.trim() || undefined,
        },
      );
    } catch (error) {
      return rethrowTripError(error, { tripId, dayId, title: activity.title });
    }
  },

  /** Idempotent: deleting a trip that is already gone is a success. */
  async deleteTrip(id: string): Promise<void> {
    await http.delete<void>(`/trips/${encodeURIComponent(id)}`);
  },

  /**
   * The trip the user last opened, so a reload can offer to resume it.
   *
   * Read from `/api/me` rather than an endpoint of its own, because it is a
   * fact about the person. Milestone 3 folds the whole of app boot into that
   * one request; until then this is a second call fetching a little more than
   * it needs.
   */
  async getActiveTripId(): Promise<string | null> {
    const user = await http.get<ApiUser>('/me');

    return user.activeTripId;
  },

  async setActiveTrip(id: string | null): Promise<void> {
    await http.put<void>('/me/active-trip', { tripId: id });
  },
};
