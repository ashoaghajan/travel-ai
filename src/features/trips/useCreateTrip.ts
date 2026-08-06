import { useCallback, useMemo, useRef, useState } from 'react';
import type { ItineraryDay, Trip } from '../../types/trip.types';
import { tripStore } from '../../store/trip.store';
import { createId } from '../../utils/id';
import { destinationLabel, hasErrors } from './editTrip';
import type { TripEditErrors } from './editTrip';
import { dayCount, emptyCreateDraft, scaffoldDays, toTripDraft, validateCreate } from './createTrip';
import type { TripCreateDraft } from './createTrip';

const CREATE_ERROR = 'We could not create this trip. Your browser storage may be full or blocked.';

/** Stands in for a destination in the preview, before one has been named. */
const UNNAMED_DESTINATION = 'Your destination';

export type CreateTripState = {
  draft: TripCreateDraft;
  errors: TripEditErrors;
  /** Derived from the dates — the days that will be saved. */
  days: ItineraryDay[];
  /**
   * Days the dates ask for, before the cap. Larger than `days.length` exactly
   * when the range is too long, which is what the preview warns about.
   */
  requestedDays: number;
  isSaving: boolean;
  saveError: string | null;
  /** True once a create has been attempted — errors stay quiet until then. */
  hasAttemptedSave: boolean;

  setField: <Field extends keyof TripCreateDraft>(
    field: Field,
    value: TripCreateDraft[Field],
  ) => void;
  /** Throws nothing — returns the saved trip, or null. */
  create: () => Promise<Trip | null>;
};

/**
 * Form state for a trip made by hand.
 *
 * Deliberately not `useEditTrip`: that hook re-baselines against a stored trip
 * and sends a patch, and neither of those exists yet here. What it does share is
 * the shape of the state it hands back, so the two forms read alike.
 */
export function useCreateTrip(): CreateTripState {
  const [draft, setDraft] = useState<TripCreateDraft>(() => emptyCreateDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);

  /**
   * One identity for this form, for its whole life.
   *
   * `tripService.createTrip` is idempotent by `draftId`, so a double click — or
   * a second submit landing while the first write is still in flight — resolves
   * to the same trip rather than two.
   */
  const draftId = useRef(createId('draft'));

  const errors = useMemo(() => validateCreate(draft), [draft]);

  // Derived, never stored: the days and the dates cannot drift apart if there
  // is only one of them.
  const destination = destinationLabel(draft);
  const days = useMemo(
    () => scaffoldDays(draft.startDate, draft.endDate, destination || UNNAMED_DESTINATION),
    [draft.startDate, draft.endDate, destination],
  );
  const requestedDays = dayCount(draft.startDate, draft.endDate);

  const setField = useCallback(
    <Field extends keyof TripCreateDraft>(field: Field, value: TripCreateDraft[Field]) => {
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const create = useCallback(async () => {
    setHasAttemptedSave(true);

    if (hasErrors(validateCreate(draft))) return null;

    setIsSaving(true);
    setSaveError(null);

    try {
      return await tripStore.saveTrip(toTripDraft(draft, draftId.current));
    } catch {
      setSaveError(CREATE_ERROR);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  return {
    draft,
    errors,
    days,
    requestedDays,
    isSaving,
    saveError,
    hasAttemptedSave,
    setField,
    create,
  };
}
