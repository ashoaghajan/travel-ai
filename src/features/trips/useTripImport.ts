import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../../services/http';
import { ERROR_CODES } from '@ai-travel/shared';
import { readTextFile } from '../../services/fileTransfer.service';
import { tripStore, useTrips } from '../../store/trip.store';
import type { Trip } from '../../types/trip.types';
import { formatBytes } from '../../utils/bytes';
import { createId } from '../../utils/id';
import {
  MAX_TRIP_BODY_BYTES,
  MAX_TRIP_FILE_BYTES,
  findDuplicateTrip,
  parseTripFile,
  toTripDraft,
  tripFieldLabel,
  tripFileMessage,
} from '../../utils/tripFile';
import type { ExportedTrip, TripImportPreview } from '../../utils/tripFile';

const IMPORT_ERROR = 'We could not import this file. Please try again.';
const UNREADABLE = 'We could not read that file.';

/**
 * A refusal from the server, said the way a person would say it.
 *
 * A 422 names the field precisely and tells the reader nothing:
 * `itinerary.2.activities.0.time`. `tripFieldLabel` turns that into "Day 3,
 * activity 1", which is somewhere they can actually look.
 */
function describeRejection(error: unknown): string {
  if (!(error instanceof ApiError)) return IMPORT_ERROR;

  if (error.code === ERROR_CODES.NETWORK) {
    return 'We could not reach the server. Nothing was imported — try again.';
  }

  if (error.code === ERROR_CODES.PAYLOAD_TOO_LARGE) return 'This trip is too large to import.';

  if (error.code === ERROR_CODES.VALIDATION_FAILED) {
    const details = error.details;

    if (details && typeof details === 'object') {
      // Insertion order is zod's issue order, so the first entry is the first
      // thing wrong with the file — which is the one worth naming.
      const [path, message] = Object.entries(details as Record<string, unknown>)[0] ?? [];

      if (typeof path === 'string' && typeof message === 'string') {
        return `We could not import this file. ${tripFieldLabel(path)}: ${message}`;
      }
    }

    return 'We could not import this file. Some of its details are not valid.';
  }

  return IMPORT_ERROR;
}

export type TripImportStage = 'choosing' | 'ready' | 'duplicate' | 'importing' | 'done';

export type TripImportState = {
  stage: TripImportStage;
  /** What the file says it holds. Null until one has been read. */
  preview: TripImportPreview | null;
  /** The trip already on the account that this file looks like. */
  duplicate: Trip | null;
  imported: Trip | null;
  error: string | null;
  selectFile: (file: File | null) => Promise<void>;
  submit: () => Promise<Trip | null>;
  importAnyway: () => Promise<Trip | null>;
  reset: () => void;
};

/**
 * Reading a trip out of a file and saving it to this account.
 *
 * There is no import endpoint: `POST /api/trips` already accepts a whole trip
 * and mints the id itself, so an import is a create whose body came off disk.
 * That also means `createTripSchema` is still the only thing deciding what a
 * trip may contain — this hook does the structural work of turning bytes into
 * a draft, and translates the server's refusal when it does not like one.
 *
 * Nothing here throws. Every entry point is a click.
 */
export function useTripImport(): TripImportState {
  const trips = useTrips();

  const [stage, setStage] = useState<TripImportStage>('choosing');
  const [preview, setPreview] = useState<TripImportPreview | null>(null);
  const [duplicate, setDuplicate] = useState<Trip | null>(null);
  const [imported, setImported] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The parsed trip. In a ref because only the preview is ever rendered. */
  const tripRef = useRef<ExportedTrip | null>(null);

  /**
   * One draft key per file the reader picks.
   *
   * `createTrip` is idempotent by `draftId`, so holding it across every attempt
   * on one file is what makes a retry safe: if the request that appeared to
   * fail had in fact committed, the retry resolves to that same trip instead of
   * a twin. Minting it per *attempt* would lose that. Minting it per file, and
   * not per file's contents, is what still lets someone deliberately import the
   * same file twice — which is the whole point of the "Import anyway" choice.
   */
  const draftIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    tripRef.current = null;
    draftIdRef.current = null;
    setStage('choosing');
    setPreview(null);
    setDuplicate(null);
    setImported(null);
    setError(null);
  }, []);

  const selectFile = useCallback(
    async (file: File | null) => {
      reset();
      if (!file) return;

      // Checked before reading: a file this big should never reach memory, and
      // whatever it is, it is not a trip.
      if (file.size > MAX_TRIP_FILE_BYTES) {
        setError(`That file is ${formatBytes(file.size)} — too large to be a trip.`);
        return;
      }

      let contents: string;

      try {
        contents = await readTextFile(file);
      } catch {
        setError(UNREADABLE);
        return;
      }

      const parsed = parseTripFile(contents);

      if (!parsed.ok) {
        setError(tripFileMessage(parsed.problem));
        return;
      }

      // What the server will actually be asked to swallow, which is what
      // predicts its answer — the file itself is indented and wrapped.
      const body = new TextEncoder().encode(JSON.stringify(parsed.trip)).length;

      if (body > MAX_TRIP_BODY_BYTES) {
        setError(`This trip is too large to import (${formatBytes(body)}). The limit is 1 MB.`);
        return;
      }

      tripRef.current = parsed.trip;
      draftIdRef.current = createId('draft');
      setPreview(parsed.preview);
      setStage('ready');
    },
    [reset],
  );

  const runImport = useCallback(async (): Promise<Trip | null> => {
    const trip = tripRef.current;
    const draftId = draftIdRef.current;
    if (!trip || !draftId) return null;

    setStage('importing');
    setError(null);

    try {
      const saved = await tripStore.saveTrip(toTripDraft(trip, draftId));

      setImported(saved);
      setStage('done');

      return saved;
    } catch (caught) {
      setError(describeRejection(caught));
      // Back to `ready`, not `choosing`: the file is still in hand and the same
      // draft key is still the right one to retry with.
      setStage('ready');

      return null;
    }
  }, []);

  const submit = useCallback(async (): Promise<Trip | null> => {
    if (!preview) return null;

    const existing = findDuplicateTrip(trips, preview);

    if (existing) {
      setDuplicate(existing);
      setStage('duplicate');

      return null;
    }

    return runImport();
  }, [preview, runImport, trips]);

  return { stage, preview, duplicate, imported, error, selectFile, submit, importAnyway: runImport, reset };
}
