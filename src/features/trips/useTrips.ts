import { useCallback, useEffect, useState } from 'react';
import type { Trip } from '../../types/trip.types';
import { tripService } from '../../services/trip.service';
import { tripStore, useTripsResource } from '../../store/trip.store';

const LOAD_ERROR = 'We could not load your saved trips.';
const DELETE_ERROR = 'We could not delete that trip. Please try again.';

/**
 * Saved trips plus the states the list screen needs.
 *
 * Status comes from the resource rather than from an effect of its own. The
 * old shape ran a second `getTrips()` purely to drive a spinner while the data
 * came from a snapshot that was already populated — which meant `isLoading`
 * was true for about a microtask and never gated on anything real. Now there
 * is one request, and the skeletons earn their keep.
 *
 * The return shape is unchanged, so `TripsPage` did not move.
 */
export function useSavedTrips() {
  const { data: trips, status } = useTripsResource();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);

  const deleteTrip = useCallback(async (trip: Trip) => {
    setDeletingTripId(trip.id);
    setDeleteError(null);

    try {
      await tripStore.deleteTrip(trip.id);
    } catch {
      setDeleteError(DELETE_ERROR);
    } finally {
      setDeletingTripId(null);
    }
  }, []);

  return {
    trips,
    // A failed delete is the more immediate thing to say; a stale load error
    // beside a list that did eventually arrive would just be confusing.
    error: deleteError ?? (status === 'error' ? LOAD_ERROR : null),
    deletingTripId,
    // 'idle' counts as loading: the fetch starts when the first subscriber
    // arrives, so a component can render one frame before it begins.
    isLoading: status === 'loading' || status === 'idle',
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
  const { data: trips, status } = useTripsResource();
  const [deepLinked, setDeepLinked] = useState<Trip | null>(null);
  const [isFetchingOne, setIsFetchingOne] = useState(false);

  const fromList = tripId ? trips.find((candidate) => candidate.id === tripId) : undefined;
  const isListLoading = status === 'loading' || status === 'idle';

  /*
   * A deep link to a trip the list does not hold.
   *
   * The list is this screen's source, but it is not exhaustive forever: an
   * address pasted into a fresh tab, or a trip created in another tab, can
   * name an id the loaded list has never seen. One lookup settles it, and
   * only once the list has actually arrived — asking earlier would fire a
   * request for every trip opened normally.
   */
  useEffect(() => {
    if (!tripId || isListLoading || fromList) return;

    let active = true;
    setIsFetchingOne(true);

    tripService
      .getTripById(tripId)
      .then((found) => {
        if (active) setDeepLinked(found ?? null);
      })
      .catch(() => {
        if (active) setDeepLinked(null);
      })
      .finally(() => {
        if (active) setIsFetchingOne(false);
      });

    return () => {
      active = false;
    };
  }, [tripId, isListLoading, fromList]);

  const trip = fromList ?? (deepLinked?.id === tripId ? deepLinked : undefined);

  // Remember the last trip opened; `deleteTrip` clears it if that trip goes.
  useEffect(() => {
    if (trip) void tripStore.setActiveTrip(trip.id);
  }, [trip]);

  const isLoading = isListLoading || isFetchingOne;

  return {
    trip,
    isLoading,
    notFound: !isLoading && !trip,
  };
}
