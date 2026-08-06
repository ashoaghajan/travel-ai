import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../components/common/Button';
import { ROUTES } from '../../../app/routes';
import { describeOccupancy } from '@ai-travel/shared';
import { useTrips } from '../../../store/trip.store';
import { bookingStore, useBookings } from '../../../store/booking.store';
import { BookingAlreadyOnTripError } from '../../../services/booking.service';
import type { BookingDraft } from '../../../types/booking.types';
import type { Trip } from '../../../types/trip.types';
import {
  bookingKindLabel,
  rebasePriceBasis,
  stayGaps,
  stayPriceBasis,
} from '../../../utils/booking';
import { formatCurrency } from '../../../utils/currency';
import { formatDateRange, nightsBetween } from '../../../utils/date';
import { formatNightCount, tripPricing } from '../../../utils/trip';
import styles from './AddBookingToTripDialog.module.css';

const SAVE_ERROR = 'We could not record that. Your browser storage may be full or blocked.';

function describeError(error: unknown): string {
  if (error instanceof BookingAlreadyOnTripError) return error.message;
  return SAVE_ERROR;
}

/**
 * A date pulled inside the trip it is being filed against.
 *
 * The picker's `min`/`max` stop a reader *choosing* an outside date, but they
 * do not fix one that is already there — a fare found for one trip and then
 * filed against another, or a draft whose provider quoted a nearby day. Left
 * alone that value fails the browser's own validation on submit, which reads
 * as the dialog refusing to work rather than as a date needing a change.
 *
 * ISO dates compare correctly as strings, which is the whole reason the app
 * stores them that way.
 */
function clampToTrip(date: string, trip: Trip | null): string {
  if (!date || !trip?.startDate || !trip?.endDate) return date;

  if (date < trip.startDate) return trip.startDate;
  if (date > trip.endDate) return trip.endDate;

  return date;
}

export type AddBookingToTripDialogProps = {
  /**
   * Built by one of the `booking.service` mappers; the first draft's `tripId`
   * preselects.
   *
   * A list rather than one, because a round-trip fare is two flights and each
   * is its own booking — see `flightToBookingDrafts`.
   */
  drafts: BookingDraft[];
  onClose: () => void;
  /** Called once the bookings are recorded, with where they went. */
  onAdded?: (label: string) => void;
};

/**
 * Trip, date, whether it is booked yet — then record it.
 *
 * Built like `AddToTripDialog` in the explorer: a native `<dialog>` so focus
 * trapping, Escape and the backdrop come from the browser, a trip list read
 * live from the store, and an immediate write on submit rather than a draft.
 *
 * The one real difference is that "no trip" is a legitimate answer here. You
 * can find a fare before deciding which trip it is for, and demanding a trip
 * at that moment is what would send people back to the partner with nothing
 * recorded — so the picker offers "Decide later" and having no trips at all is
 * a normal path rather than a dead end.
 */
export function AddBookingToTripDialog({
  drafts,
  onClose,
  onAdded,
}: AddBookingToTripDialogProps) {
  const [first, ...rest] = drafts;
  const trips = useTrips();
  const bookings = useBookings();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tripFieldId = useId();
  const dateFieldId = useId();
  const endDateFieldId = useId();
  const referenceFieldId = useId();

  /** A stay occupies a range; everything else happens on a day. */
  const isStay = first.kind === 'hotel';

  const [tripId, setTripId] = useState(first.tripId ?? '');
  // Clamped on the way in too: the preselected trip may not be the one this
  // draft's date was quoted against.
  const [date, setDate] = useState(() =>
    clampToTrip(first.date, trips.find((trip) => trip.id === first.tripId) ?? null),
  );
  /**
   * Check-out, for a stay.
   *
   * Defaults to the trip's own last day, which is what someone filing a hotel
   * against a five-day trip means by "the whole trip" — they should not have
   * to retype what the trip already knows.
   */
  const [endDate, setEndDate] = useState(() => {
    const trip = trips.find((candidate) => candidate.id === first.tripId) ?? null;
    return clampToTrip(first.endDate ?? trip?.endDate ?? '', trip);
  });
  const [isBooked, setIsBooked] = useState(false);
  const [reference, setReference] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `showModal` is the only way to get the backdrop and the focus trap; it
  // cannot be expressed as a prop, so it happens on mount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  const kind = bookingKindLabel(first.kind).toLowerCase();

  /** One trip's bookings, for working out which of its nights are spoken for. */
  function bookingsFor(id: string) {
    return bookings.filter((booking) => booking.tripId === id);
  }

  /*
   * The trip being filed against, or null for "Decide later".
   *
   * It bounds the date picker: a booking belongs to the days of its trip, and
   * a calendar that lets you file a hotel for a fortnight after you fly home
   * is offering a choice that can only be a mistake. With no trip chosen there
   * is nothing to bound it by, and the picker stays open.
   */
  const chosen = trips.find((candidate) => candidate.id === tripId) ?? null;

  /*
   * The nights this stay may occupy.
   *
   * Narrower than the trip, and that is the point: a trip already booked from
   * the 3rd to the 6th has one night left, so offering the 3rd to the 5th
   * again is offering a double booking. The bound follows the gap the reader
   * is filling rather than the trip around it.
   *
   * `min`/`max` describe one contiguous range, so a trip with two gaps bounds
   * to the one this booking is aimed at; the other is filled by adding again,
   * which is what a second booking is.
   */
  const gaps =
    isStay && chosen ? stayGaps(chosen.startDate, chosen.endDate, bookingsFor(chosen.id)) : [];

  const activeGap =
    gaps.find((gap) => date >= gap.from && date < gap.to) ?? gaps[0] ?? null;

  /** Empty dates would make `min=""`, which browsers treat as no bound. */
  const earliest = activeGap?.from ?? chosen?.startDate ?? undefined;
  const latest = activeGap?.to ?? chosen?.endDate ?? undefined;

  /*
   * What the stay comes to, shown as the dates are picked.
   *
   * The rate on its own has been the confusing part all along — $116 against a
   * five-night trip is not what anyone pays — so the dialog does the
   * multiplication where the decision is being made rather than leaving it to
   * be discovered on the bookings list afterwards.
   */
  const nights = isStay && date && endDate ? nightsBetween(date, endDate) : 0;
  const stayPrice = first.price !== undefined && nights > 0 ? first.price * nights : null;

  function chooseTrip(nextTripId: string) {
    const next = trips.find((candidate) => candidate.id === nextTripId) ?? null;

    setTripId(nextTripId);

    /*
     * A stay lands in the new trip's first free gap rather than being clamped
     * into its outer dates — clamping could drop it on nights that trip
     * already has booked, which is the double booking this is here to stop.
     */
    if (isStay && next) {
      const [gap] = stayGaps(next.startDate, next.endDate, bookingsFor(next.id));

      setDate(gap ? gap.from : clampToTrip(date, next));
      setEndDate(gap ? gap.to : clampToTrip(endDate || next.endDate, next));
      return;
    }

    // The dates that were in range for the old trip may be outside the new one.
    setDate((current) => clampToTrip(current, next));
    setEndDate((current) => clampToTrip(current || (next?.endDate ?? ''), next));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    setIsSaving(true);
    setError(null);

    try {
      // Sequentially, not in parallel: each write reads the stored list and
      // writes it back, so two at once would lose one of them.
      for (const [index, draft] of drafts.entries()) {
        await bookingStore.create({
          ...draft,
          tripId: tripId || null,
          // A stay is counted by its own nights; everything else keeps the
          // basis it was captured with, recounted against the chosen trip.
          priceBasis:
            isStay && draft.price !== undefined
              ? stayPriceBasis(date, endDate)
              : rebasePriceBasis(draft.priceBasis, chosen ? tripPricing(chosen) : null),
          // Only the first leg's date is editable here — the rest keep the
          // days the provider quoted, which is what makes them separate rows.
          date: index === 0 ? date : draft.date,
          endDate: isStay ? endDate || undefined : draft.endDate,
          status: isBooked ? 'booked' : 'saved',
          // The same confirmation covers both legs of one fare.
          reference: isBooked ? reference.trim() : '',
        });
      }

      onAdded?.(chosen ? chosen.title : 'your bookings');
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
          {rest.length > 0 ? `Add these ${drafts.length} flights to a trip` : `Add this ${kind} to a trip`}
        </h2>
        <p className={styles.subtitle}>
          {first.title}
          {rest.map((other) => (
            <span key={other.source?.resultId ?? other.title} className={styles.alsoTitle}>
              {other.title}
            </span>
          ))}
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={tripFieldId}>
            Trip
          </label>
          <select
            id={tripFieldId}
            className={styles.control}
            value={tripId}
            onChange={(event) => chooseTrip(event.target.value)}
            disabled={isSaving}
          >
            {/* Not a dead end, unlike the explorer's day picker: a booking with
                no trip is a real, useful thing to have recorded. */}
            <option value="">Decide later</option>
            {trips.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title} · {candidate.destination}
              </option>
            ))}
          </select>
          {trips.length === 0 ? (
            <p className={styles.hint}>
              You have no trips yet — this will be kept until you make one.{' '}
              <Button to={ROUTES.tripNew} variant="secondary" size="md" onClick={onClose}>
                New Trip
              </Button>
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={dateFieldId}>
            {isStay ? 'Check-in' : rest.length > 0 ? 'Outbound date' : 'Date'}
          </label>
          <input
            id={dateFieldId}
            className={styles.control}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            min={earliest}
            max={latest}
            disabled={isSaving}
            aria-describedby={chosen ? `${dateFieldId}-range` : undefined}
          />
          {/* Said out loud as well as enforced. A calendar with most of its
              days greyed out and no explanation reads as broken. */}
          {chosen && earliest && latest ? (
            <p id={`${dateFieldId}-range`} className={styles.hint}>
              {/* Names the *gap* when there is one, because "within the trip"
                  next to a calendar that refuses most of the trip reads as a
                  bug rather than as a stay already booked. */}
              {activeGap
                ? `Still free: ${formatDateRange(earliest, latest)}`
                : `Within the trip: ${formatDateRange(earliest, latest)}`}
            </p>
          ) : null}
        </div>

        {/* A stay is a range, and the number of nights in it is what the
            nightly rate is multiplied by — so it is asked for here rather than
            inferred from the trip and quietly wrong for a shorter booking. */}
        {isStay ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={endDateFieldId}>
              Check-out
            </label>
            <input
              id={endDateFieldId}
              className={styles.control}
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              // Never before the check-in, whatever the trip allows.
              min={date || earliest}
              max={latest}
              disabled={isSaving}
              aria-describedby={`${endDateFieldId}-nights`}
            />
            <p id={`${endDateFieldId}-nights`} className={styles.hint}>
              {nights > 0
                ? // Who the figure covers, said where the reader commits to it.
                  `${formatNightCount(nights)}${
                    stayPrice !== null ? ` · ${formatCurrency(stayPrice)}` : ''
                  }${chosen ? ` for ${describeOccupancy(chosen.travellers)}` : ''}`
                : 'Pick the day you check out.'}
            </p>
          </div>
        ) : null}

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={isBooked}
            onChange={(event) => setIsBooked(event.target.checked)}
            disabled={isSaving}
          />
          {/* Asked rather than assumed: the partner never tells us whether the
              checkout completed, so only the reader can say. */}
          I have already booked this
        </label>

        {isBooked ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={referenceFieldId}>
              Reference
            </label>
            <input
              id={referenceFieldId}
              className={styles.control}
              value={reference}
              placeholder="Confirmation number"
              onChange={(event) => setReference(event.target.value)}
              disabled={isSaving}
            />
          </div>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSaving}>
            {isSaving ? 'Adding…' : 'Add to trip'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
