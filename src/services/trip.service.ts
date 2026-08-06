import type { ItineraryActivity, Trip, TripDraft } from '../types/trip.types';
import type { Activity } from '../types/travel.types';
import { createId } from '../utils/id';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Trip persistence.
 *
 * The methods are async and mirror the Stage 2 endpoints (`GET /api/trips`,
 * `POST /api/trips`, …) so swapping localStorage for `fetch` later touches
 * only this file — README "Backend Preparation Rule".
 */

function readTrips(): Trip[] {
  const trips = storageService.get<Trip[]>(STORAGE_KEYS.trips, []);
  return Array.isArray(trips) ? trips : [];
}

function writeTrips(trips: Trip[]): void {
  storageService.set(STORAGE_KEYS.trips, trips);
}

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

/** Where an imported attraction lands when the day already has a schedule. */
const DEFAULT_IMPORT_TIME = '12:00';

/**
 * Sorts "09:30" before "14:00"; anything unparseable sinks to the end.
 *
 * Exported for the itinerary editor, which places a picked attraction by the
 * same rule this service sorts by.
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
    return readTrips();
  },

  async getTripById(id: string): Promise<Trip | undefined> {
    return readTrips().find((trip) => trip.id === id);
  },

  /**
   * Saves a generated draft.
   *
   * Idempotent by `draftId`: saving the same itinerary twice — a double click,
   * a second tab, or the same conversation after a reload — returns the trip
   * that already exists instead of creating a duplicate.
   */
  async createTrip(draft: TripDraft): Promise<Trip> {
    const trips = readTrips();

    if (draft.draftId) {
      const existing = trips.find((trip) => trip.draftId === draft.draftId);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const trip: Trip = {
      ...draft,
      id: createId('trip'),
      createdAt: now,
      updatedAt: now,
    };

    writeTrips([trip, ...trips]);
    return trip;
  },

  /** Edits persist immediately and bump `updatedAt`. */
  async updateTrip(id: string, patch: Partial<TripDraft>): Promise<Trip> {
    const trips = readTrips();
    const index = trips.findIndex((trip) => trip.id === id);
    if (index === -1) throw new TripNotFoundError(id);

    const updated: Trip = {
      ...trips[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    writeTrips(trips.map((trip, i) => (i === index ? updated : trip)));
    return updated;
  },

  /**
   * Adds an attraction from the explorer to one day of a trip.
   *
   * The day's activities stay in time order, so an import lands where it
   * belongs rather than at the bottom. Re-adding the same place is refused
   * instead of silently duplicating it — the caller shows that as a message,
   * which is more useful than two identical rows.
   */
  async addActivityToDay(
    tripId: string,
    dayId: string,
    activity: Activity,
    options: { time?: string } = {},
  ): Promise<Trip> {
    const trips = readTrips();
    const index = trips.findIndex((trip) => trip.id === tripId);
    if (index === -1) throw new TripNotFoundError(tripId);

    const trip = trips[index];
    const dayIndex = trip.itinerary.findIndex((day) => day.id === dayId);
    if (dayIndex === -1) throw new ItineraryDayNotFoundError(dayId);

    const day = trip.itinerary[dayIndex];
    if (day.activities.some((entry) => entry.sourceActivityId === activity.id)) {
      throw new ActivityAlreadyOnDayError(activity.title);
    }

    const entry = toItineraryActivity(activity, options.time?.trim() || DEFAULT_IMPORT_TIME);
    const activities = [...day.activities, entry].sort(
      (a, b) => minutesOf(a.time) - minutesOf(b.time),
    );

    const updated: Trip = {
      ...trip,
      itinerary: trip.itinerary.map((candidate, i) =>
        i === dayIndex ? { ...candidate, activities } : candidate,
      ),
      updatedAt: new Date().toISOString(),
    };

    writeTrips(trips.map((candidate, i) => (i === index ? updated : candidate)));
    return updated;
  },

  async deleteTrip(id: string): Promise<void> {
    writeTrips(readTrips().filter((trip) => trip.id !== id));

    // Never leave the active pointer aimed at a trip that no longer exists.
    if (readActiveTripId() === id) {
      storageService.remove(STORAGE_KEYS.activeTripId);
    }
  },

  /** The trip the user last opened, so a reload can offer to resume it. */
  async setActiveTrip(id: string | null): Promise<void> {
    if (id === null) {
      storageService.remove(STORAGE_KEYS.activeTripId);
      return;
    }
    storageService.set(STORAGE_KEYS.activeTripId, id);
  },
};

/**
 * Synchronous reads, used only by the trip store so subscribers paint the
 * stored state on the first render. Stage 2 replaces them with the async API
 * plus a loading state.
 */
export function readTripsSync(): Trip[] {
  return readTrips();
}

export function readActiveTripId(): string | null {
  return storageService.get<string | null>(STORAGE_KEYS.activeTripId, null);
}
