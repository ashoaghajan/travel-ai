import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/common/Button';
import { EmptyState } from '../../../components/common/EmptyState';
import { SuitcaseIcon } from '../../../components/common/icons';
import { ROUTES } from '../../../app/routes';
import { formatShortDate } from '../../../utils/date';
import { tripStore } from '../../../store/trip.store';
import { useTrips } from '../../../store/trip.store';
import {
  ActivityAlreadyOnDayError,
  ItineraryDayNotFoundError,
  TripNotFoundError,
} from '../../../services/trip.service';
import type { Activity } from '../../../types/travel.types';
import { addableTrips, canAddToTrip } from '../trip.filters';
import styles from './AddToTripDialog.module.css';

const SAVE_ERROR = 'We could not add this to your trip. Your browser storage may be full.';

function describeError(error: unknown): string {
  if (error instanceof ActivityAlreadyOnDayError) return error.message;
  if (error instanceof TripNotFoundError) return 'That trip no longer exists.';
  if (error instanceof ItineraryDayNotFoundError) return 'That day is no longer on the trip.';
  return SAVE_ERROR;
}

export type AddToTripDialogProps = {
  activity: Activity;
  /**
   * The country the explorer was browsing when this place was found. Null when
   * it is not known — the reader is following their trip, or arrived by link —
   * which allows every trip, since a mismatch cannot be shown.
   */
  placeCountry?: string | null;
  onClose: () => void;
  /** Called once the activity is on the itinerary. */
  onAdded?: (tripTitle: string) => void;
};

/**
 * Trip, then day, then add.
 *
 * A native `<dialog>` so focus trapping, Escape, and the backdrop come from
 * the browser rather than from us. The trip list comes from the store, so a
 * trip saved in another tab is already here.
 *
 * A trip in another country cannot be chosen — see `trip.filters.ts` for why
 * the test is the country and not the city. Those trips stay *visible* in the
 * list, disabled and labelled with where they go: removing them would leave
 * someone staring at a picker missing the trip they were looking for, with
 * nothing to say why.
 */
export function AddToTripDialog({
  activity,
  placeCountry = null,
  onClose,
  onAdded,
}: AddToTripDialogProps) {
  const trips = useTrips();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tripFieldId = useId();
  const dayFieldId = useId();

  const addable = useMemo(() => addableTrips(trips, placeCountry), [trips, placeCountry]);
  /** Every trip is in the wrong country — there is nothing to choose. */
  const noneAddable = trips.length > 0 && addable.length === 0;

  const [tripId, setTripId] = useState(() => addable[0]?.id ?? '');
  const [dayId, setDayId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trip = trips.find((candidate) => candidate.id === tripId);
  const days = trip?.itinerary ?? [];

  // `showModal` is the only way to get the backdrop and the focus trap; it
  // cannot be expressed as a prop, so it happens on mount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Selecting a trip picks its first day, so the common case is one click.
  // Keyed on the day's id rather than the array, which is rebuilt every render.
  const firstDayId = days[0]?.id ?? '';
  useEffect(() => {
    setDayId(firstDayId);
  }, [tripId, firstDayId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trip || !dayId) return;

    // The disabled options already prevent this; checked again because a
    // `<select>` can be driven from the keyboard and from devtools, and adding
    // the stop is the irreversible half.
    const eligibility = canAddToTrip(trip, placeCountry);
    if (!eligibility.addable) {
      setError(`${trip.title} ${eligibility.reason}, so this cannot go on it.`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await tripStore.addActivityToDay(trip.id, dayId, activity);
      onAdded?.(trip.title);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop —
        // its children stop the event reaching here.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <form className={styles.body} onSubmit={submit}>
        <h2 id={titleId} className={styles.title}>
          Add to a trip
        </h2>
        <p className={styles.subtitle}>{activity.title}</p>

        {trips.length === 0 ? (
          <EmptyState
            icon={<SuitcaseIcon size={24} />}
            title="You have no trips yet"
            description="Create a trip first, then you can add attractions to its schedule."
            action={
              <>
                <Button to={ROUTES.tripNew} variant="primary" onClick={onClose}>
                  New Trip
                </Button>
                <Button to={ROUTES.planner} variant="secondary" onClick={onClose}>
                  Plan with AI
                </Button>
              </>
            }
          />
        ) : noneAddable ? (
          <EmptyState
            icon={<SuitcaseIcon size={24} />}
            title={`None of your trips go to ${placeCountry}`}
            description={`${activity.title} is in ${placeCountry}. Start a trip there and it can go straight onto the schedule.`}
            action={
              <>
                <Button to={ROUTES.tripNew} variant="primary" onClick={onClose}>
                  New Trip
                </Button>
                <Button to={ROUTES.planner} variant="secondary" onClick={onClose}>
                  Plan with AI
                </Button>
              </>
            }
          />
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={tripFieldId}>
                Trip
              </label>
              <select
                id={tripFieldId}
                className={styles.control}
                value={tripId}
                onChange={(event) => setTripId(event.target.value)}
                disabled={isSaving}
              >
                {trips.map((candidate) => {
                  const eligibility = canAddToTrip(candidate, placeCountry);

                  return (
                    <option
                      key={candidate.id}
                      value={candidate.id}
                      disabled={!eligibility.addable}
                    >
                      {candidate.title} · {candidate.destination}
                      {eligibility.addable ? '' : ` — ${eligibility.reason}`}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={dayFieldId}>
                Day
              </label>
              <select
                id={dayFieldId}
                className={styles.control}
                value={dayId}
                onChange={(event) => setDayId(event.target.value)}
                disabled={isSaving || days.length === 0}
              >
                {days.length === 0 ? (
                  <option value="">This trip has no days yet</option>
                ) : (
                  days.map((day) => (
                    <option key={day.id} value={day.id}>
                      Day {day.dayNumber} · {formatShortDate(day.date)} · {day.destination}
                    </option>
                  ))
                )}
              </select>
            </div>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {trips.length > 0 && !noneAddable ? (
            <Button type="submit" variant="primary" disabled={isSaving || !dayId}>
              {isSaving ? 'Adding…' : 'Add to trip'}
            </Button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}
