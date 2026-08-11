import { useCallback, useState } from 'react';
import type { TripDraft } from '../../types/trip.types';
import { downloadTextFile } from '../../services/fileTransfer.service';
import { buildTripFile, serialiseTripFile, tripFileName } from '../../utils/tripFile';

const EXPORT_ERROR = 'We could not save that file. Your browser may have blocked the download.';

export type TripExportState = {
  /** Throws nothing — a failure lands in `error` instead. */
  exportTrip: (trip: TripDraft) => void;
  error: string | null;
};

/**
 * Writing one trip to a file the reader can hand to someone else.
 *
 * Synchronous on purpose: nothing here waits on the network. The trip is
 * already in hand and the file is built from it — so pressing Export cannot
 * fail slowly, and there is no pending state worth rendering.
 *
 * Takes a draft rather than a saved trip, so the planner can offer the same
 * action on an itinerary nobody has saved yet.
 */
export function useTripExport(): TripExportState {
  const [error, setError] = useState<string | null>(null);

  const exportTrip = useCallback((trip: TripDraft) => {
    try {
      downloadTextFile(tripFileName(trip), serialiseTripFile(buildTripFile(trip)));
      setError(null);
    } catch {
      setError(EXPORT_ERROR);
    }
  }, []);

  return { exportTrip, error };
}
