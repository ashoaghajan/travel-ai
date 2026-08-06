import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ItineraryActivity, Trip } from '../../types/trip.types';
import type { Activity } from '../../types/travel.types';
import { tripStore } from '../../store/trip.store';
import { TripNotFoundError } from '../../services/trip.service';
import {
  addActivity,
  addNote,
  addPickedActivity,
  hasErrors,
  isDirty,
  removeActivity,
  removeNote,
  toEditDraft,
  toPatch,
  updateActivity,
  updateNote,
  validate,
} from './editTrip';
import type { TripEditDraft, TripEditErrors } from './editTrip';

const SAVE_ERROR = 'We could not save these changes. Your browser storage may be full or blocked.';

function describeError(error: unknown): string {
  if (error instanceof TripNotFoundError) return 'This trip is no longer saved.';
  return SAVE_ERROR;
}

export type EditTripState = {
  draft: TripEditDraft;
  errors: TripEditErrors;
  /** True while the draft differs from the saved trip. */
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  /** True once a save has been attempted — errors stay quiet until then. */
  hasAttemptedSave: boolean;

  setField: <Field extends keyof TripEditDraft>(
    field: Field,
    value: TripEditDraft[Field],
  ) => void;
  editActivity: (
    dayId: string,
    activityId: string,
    patch: Partial<Pick<ItineraryActivity, 'title' | 'description' | 'time'>>,
  ) => void;
  deleteActivity: (dayId: string, activityId: string) => void;
  appendActivity: (dayId: string) => void;
  /** Adds an attraction from the explorer. Draft only — see `addPickedActivity`. */
  pickActivity: (dayId: string, activity: Activity, time: string) => void;

  /** Appends a blank note for the reader to write into. */
  appendNote: () => void;
  editNote: (noteId: string, text: string) => void;
  deleteNote: (noteId: string) => void;

  /** Throws nothing — returns whether the save went through. */
  save: () => Promise<boolean>;
  /** Discards every edit, back to the saved trip. */
  cancel: () => void;
};

/**
 * Editing state for one trip.
 *
 * The draft lives here rather than in the modal so the modal can stay a set of
 * inputs, and so the dirty check has one obvious place to happen: against the
 * trip the draft was built from, on every render, rather than a flag that
 * something has to remember to set.
 *
 * Validation messages are withheld until the first save attempt — flagging an
 * empty title on a field the user has not reached yet is noise.
 */
export function useEditTrip(trip: Trip): EditTripState {
  const [draft, setDraft] = useState<TripEditDraft>(() => toEditDraft(trip));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);

  const errors = useMemo(() => validate(draft), [draft]);
  const dirty = useMemo(() => isDirty(trip, draft), [trip, draft]);

  /**
   * Re-baselines the draft whenever the stored trip changes underneath it.
   *
   * On the trip page this hook stays mounted across a save, so without this
   * the draft would still hold the pre-save copy and read as dirty forever.
   * `updatedAt` moves on every write, which also covers an edit made in
   * another tab — the alternative there is editing against a trip that no
   * longer exists.
   */
  useEffect(() => {
    setDraft(toEditDraft(trip));
    setSaveError(null);
    setHasAttemptedSave(false);
    // Keyed on identity plus write time, not the object, which is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id, trip.updatedAt]);

  const setField = useCallback(
    <Field extends keyof TripEditDraft>(field: Field, value: TripEditDraft[Field]) => {
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const editActivity = useCallback(
    (
      dayId: string,
      activityId: string,
      patch: Partial<Pick<ItineraryActivity, 'title' | 'description' | 'time'>>,
    ) => {
      setDraft((current) => updateActivity(current, dayId, activityId, patch));
    },
    [],
  );

  const deleteActivity = useCallback((dayId: string, activityId: string) => {
    setDraft((current) => removeActivity(current, dayId, activityId));
  }, []);

  const appendActivity = useCallback((dayId: string) => {
    setDraft((current) => addActivity(current, dayId));
  }, []);

  const pickActivity = useCallback((dayId: string, activity: Activity, time: string) => {
    setDraft((current) => addPickedActivity(current, dayId, activity, time));
  }, []);

  const appendNote = useCallback(() => {
    setDraft((current) => addNote(current));
  }, []);

  const editNote = useCallback((noteId: string, text: string) => {
    setDraft((current) => updateNote(current, noteId, text));
  }, []);

  const deleteNote = useCallback((noteId: string) => {
    setDraft((current) => removeNote(current, noteId));
  }, []);

  const cancel = useCallback(() => {
    setDraft(toEditDraft(trip));
    setSaveError(null);
    setHasAttemptedSave(false);
  }, [trip]);

  const save = useCallback(async () => {
    setHasAttemptedSave(true);

    if (hasErrors(validate(draft))) return false;

    const patch = toPatch(trip, draft);
    // Nothing changed — treat it as a successful no-op rather than writing a
    // new `updatedAt` for an edit that was not made.
    if (Object.keys(patch).length === 0) return true;

    setIsSaving(true);
    setSaveError(null);

    try {
      await tripStore.updateTrip(trip.id, patch);
      return true;
    } catch (caught) {
      setSaveError(describeError(caught));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [trip, draft]);

  return {
    draft,
    errors,
    isDirty: dirty,
    isSaving,
    saveError,
    hasAttemptedSave,
    setField,
    editActivity,
    deleteActivity,
    appendActivity,
    pickActivity,
    appendNote,
    editNote,
    deleteNote,
    save,
    cancel,
  };
}
