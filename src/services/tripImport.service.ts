import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { http } from './http';
import { STORAGE_KEYS, archiveKey, storageService } from './localStorage.service';

/**
 * Moving a browser's trips into the account that just signed in.
 *
 * Everyone who used this app before the trips API existed has their trips in
 * `localStorage` and nowhere else. Without this they sign in after the deploy
 * and find an empty list — the data still on their disk, and the app no longer
 * looking at it.
 *
 * Runs once per account. Never blocks the sign-in redirect, and never throws:
 * a failed import must leave the reader signed in with an app that works, and
 * the local data untouched so the next attempt can try again.
 *
 * No React component may import this file.
 */

type Marker = {
  userId: string;
  at: string;
  imported: number;
};

type MigrateResponse = {
  alreadyMigrated: boolean;
  imported: number;
  importedBookings: number;
};

export type ImportOutcome =
  | { status: 'skipped' }
  | { status: 'imported'; trips: number; bookings: number }
  | { status: 'failed' };

/**
 * Read straight from storage rather than through `tripService`.
 *
 * `tripService` talks to the API now — asking it for "the local trips" would
 * fetch the empty account we are about to fill.
 */
function readLocalTrips(): Trip[] {
  const trips = storageService.get<Trip[]>(STORAGE_KEYS.trips, []);

  return Array.isArray(trips) ? trips : [];
}

function readLocalBookings(): Booking[] {
  const bookings = storageService.get<Booking[]>(STORAGE_KEYS.bookings, []);

  return Array.isArray(bookings) ? bookings : [];
}

function readMarker(): Marker | null {
  return storageService.get<Marker | null>(STORAGE_KEYS.migratedFor, null);
}

function writeMarker(userId: string, imported: number): void {
  try {
    storageService.set<Marker>(STORAGE_KEYS.migratedFor, {
      userId,
      at: new Date().toISOString(),
      imported,
    });
  } catch {
    // Full or blocked storage. The server's own marker still stops a second
    // import, so the worst case is one wasted request on the next sign-in.
  }
}

/**
 * Park the imported keys instead of deleting them.
 *
 * This is the rollback path, and the reason it exists is that the upload has
 * no undo. Until someone has seen their trips in the new account, the copy on
 * their disk is the only one that was ever theirs. Settings offers a "clear
 * local backup" for when they are satisfied.
 */
function archiveImportedKeys(userId: string): void {
  for (const key of [STORAGE_KEYS.trips, STORAGE_KEYS.activeTripId, STORAGE_KEYS.bookings]) {
    const value = storageService.get<unknown>(key, undefined);
    if (value === undefined) continue;

    try {
      storageService.set(archiveKey(userId, key), value);
      storageService.remove(key);
    } catch {
      // Leave both copies rather than risk losing the only one.
    }
  }
}

export const tripImportService = {
  /**
   * Hand this browser's trips to `userId`, if there are any and it has not
   * happened before.
   *
   * The two markers do different jobs. The server's stops a *second device*
   * re-importing data this account already claimed. The client's stops this
   * browser asking again — but it is per-browser, so a second browser holding
   * genuinely different trips can still contribute. Server-only would silently
   * drop that browser; client-only would re-import after a storage clear.
   */
  async run(userId: string): Promise<ImportOutcome> {
    const marker = readMarker();
    if (marker?.userId === userId) return { status: 'skipped' };

    const trips = readLocalTrips();
    const bookings = readLocalBookings();

    // The common case by far, and it must cost nothing: a new account on a
    // fresh browser has nothing to hand over. Bookings count too — someone can
    // have saved a fare without ever creating a trip.
    if (trips.length === 0 && bookings.length === 0) {
      writeMarker(userId, 0);
      return { status: 'skipped' };
    }

    const activeTripId = storageService.get<string | null>(STORAGE_KEYS.activeTripId, null);

    try {
      const result = await http.post<MigrateResponse>('/migrate/local', {
        trips,
        bookings,
        activeTripId,
      });

      archiveImportedKeys(userId);
      writeMarker(userId, result.imported);

      return result.alreadyMigrated
        ? { status: 'skipped' }
        : {
            status: 'imported',
            trips: result.imported,
            bookings: result.importedBookings,
          };
    } catch {
      /*
       * Touch nothing.
       *
       * No marker, no archiving — the local data stays exactly where it is and
       * the next sign-in tries again. Half-importing and then recording it as
       * done is the one outcome that loses trips.
       */
      return { status: 'failed' };
    }
  },

  /** Test seam, and the "clear local backup" action's read. */
  hasRun(userId: string): boolean {
    return readMarker()?.userId === userId;
  },
};
