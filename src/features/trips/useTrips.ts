import { useCallback, useEffect, useState } from 'react';
import type { Trip } from '../../types/trip.types';
import { tripService } from '../../services/trip.service';
import { tripStore, useTrips as useTripsSnapshot } from '../../store/trip.store';

type LoadStatus = 'loading' | 'ready' | 'error';

const LOAD_ERROR = 'We could not load your saved trips.';
const DELETE_ERROR = 'We could not delete that trip. Please try again.';

/**
 * Saved trips plus the states the list screen needs.
 *
 * The data comes from the store (so a save anywhere updates the list), while
 * the `tripService` call drives the load status. In Stage 1 that resolves in a
 * microtask; in Stage 2 it becomes the real request and the skeletons earn
 * their keep.
 */
export function useSavedTrips() {
  const trips = useTripsSnapshot();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    tripService
      .getTrips()
      .then(() => {
        if (active) setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
        setError(LOAD_ERROR);
      });

    return () => {
      active = false;
    };
  }, []);

  const deleteTrip = useCallback(async (trip: Trip) => {
    setDeletingTripId(trip.id);
    setError(null);

    try {
      await tripStore.deleteTrip(trip.id);
    } catch {
      setError(DELETE_ERROR);
    } finally {
      setDeletingTripId(null);
    }
  }, []);

  return {
    trips,
    error,
    deletingTripId,
    isLoading: status === 'loading',
    deleteTrip,
  };
}

const SAVE_ERROR = 'We could not save this trip. Your browser storage may be full or blocked.';

/**
 * Save action for the trip summary.
 *
 * The summary always opens a trip that is already persisted, so saving is
 * idempotent: it re-writes the trip and refreshes `updatedAt`. When the
 * planner can hand an unsaved draft to this screen, the same handler will
 * create it instead — the button contract does not change.
 */
export function useTripSave(tripId: string | undefined) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!tripId) return;

    setStatus('saving');
    setError(null);

    try {
      await tripService.updateTrip(tripId, {});
      setStatus('saved');
    } catch {
      setStatus('error');
      setError(SAVE_ERROR);
    }
  }, [tripId]);

  return {
    save,
    error,
    isSaving: status === 'saving',
    isSaved: status === 'saved',
  };
}

const DELETE_ERROR_SINGLE = 'We could not delete that trip. Please try again.';

/** Delete action for the trip details screen. */
export function useDeleteTrip() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteTrip = useCallback(async (id: string) => {
    setIsDeleting(true);
    setError(null);

    try {
      await tripStore.deleteTrip(id);
      return true;
    } catch {
      setError(DELETE_ERROR_SINGLE);
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  return { deleteTrip, isDeleting, error };
}

/**
 * One trip by id. `notFound` covers both an unknown id and a trip deleted in
 * another tab.
 *
 * Opening a trip records it as the active one, so the trips list can offer to
 * resume it after a reload.
 */
export function useTripDetails(tripId: string | undefined) {
  const trips = useTripsSnapshot();
  const [status, setStatus] = useState<LoadStatus>('loading');

  useEffect(() => {
    if (!tripId) {
      setStatus('ready');
      return;
    }

    let active = true;
    setStatus('loading');

    tripService
      .getTripById(tripId)
      .then(() => {
        if (active) setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [tripId]);

  const trip = tripId ? trips.find((candidate) => candidate.id === tripId) : undefined;

  // Remember the last trip opened; `deleteTrip` clears it if that trip goes.
  useEffect(() => {
    if (trip) void tripStore.setActiveTrip(trip.id);
  }, [trip]);

  return {
    trip,
    isLoading: status === 'loading',
    notFound: status !== 'loading' && !trip,
  };
}
