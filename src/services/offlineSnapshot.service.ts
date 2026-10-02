import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import type { StorageKey } from './localStorage.service';

type Snapshot<T> = { savedAt: string; data: T };

function read<T>(key: StorageKey): Snapshot<T> | null {
  const snapshot = storageService.get<Snapshot<T> | null>(key, null);
  if (!snapshot || typeof snapshot.savedAt !== 'string' || !Array.isArray(snapshot.data)) return null;
  return snapshot;
}

function write<T>(key: StorageKey, data: T): void {
  storageService.set(key, { savedAt: new Date().toISOString(), data });
}

/** Read-only offline copies. The API remains authoritative for every write. */
export const offlineSnapshotService = {
  readTrips: (): Snapshot<Trip[]> | null => read<Trip[]>(STORAGE_KEYS.offlineTrips),
  writeTrips: (data: Trip[]): void => write(STORAGE_KEYS.offlineTrips, data),
  readBookings: (): Snapshot<Booking[]> | null => read<Booking[]>(STORAGE_KEYS.offlineBookings),
  writeBookings: (data: Booking[]): void => write(STORAGE_KEYS.offlineBookings, data),
};
