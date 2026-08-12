import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ApiSharedTrip } from '@ai-travel/shared';
import { IconButton } from '../../../components/common/IconButton';
import { Skeleton } from '../../../components/common/Skeleton';
import { CloseIcon } from '../../../components/common/icons';
import type { ExportedDay, ExportedTrip } from '../../../utils/tripFile';
import styles from './SharedTripPreview.module.css';

export type SharedTripPreviewProps = {
  offer: ApiSharedTrip | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
};

/**
 * A shared trip, read-only, before deciding what to do about it.
 *
 * Accepting without this would be a blind command: a card says a title and five
 * days, and a person is being asked to put somebody else's itinerary in their
 * account on that basis.
 *
 * Read-only in the strongest sense — no edit affordances, no bookings, nothing
 * that writes. **Bookings are not missing by accident**: they are facts about
 * the sender's money and they never travel, which the import rules settled
 * before this feature existed.
 */
export function SharedTripPreview({ offer, isLoading, error, onClose }: SharedTripPreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  const trip = offer?.trip as ExportedTrip | undefined;

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="Shared trip"
      onCancel={onClose}
      onClick={(event) => {
        // The backdrop is the dialog element itself; a click on a child is not
        // a click on it. The same dismissal every other dialog here offers.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{offer?.share.title ?? 'Shared trip'}</h2>
          {offer ? (
            <p className={styles.subtitle}>
              {offer.share.destination ? `${offer.share.destination} · ` : ''}
              {offer.share.dayCount} {offer.share.dayCount === 1 ? 'day' : 'days'}
            </p>
          ) : null}
        </div>

        <IconButton label="Close the preview" onClick={onClose}>
          <CloseIcon size={20} />
        </IconButton>
      </header>

      <div className={styles.body}>
        {isLoading ? (
          <div className={styles.loading} aria-busy="true">
            <span className="visually-hidden">Loading the trip…</span>
            <Skeleton height="72px" radius="lg" />
            <Skeleton height="72px" radius="lg" />
          </div>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {trip ? (
          <>
            <ol className={styles.days}>
              {trip.itinerary.map((day: ExportedDay) => (
                <li key={day.id} className={styles.day}>
                  <p className={styles.dayHead}>
                    <span className={styles.dayNumber}>Day {day.dayNumber}</span>
                    <span>{day.destination}</span>
                  </p>
                  {day.summary ? <p className={styles.summary}>{day.summary}</p> : null}

                  <ul className={styles.activities}>
                    {day.activities.map((activity) => (
                      <li key={activity.id} className={styles.activity}>
                        <span className={styles.time}>{activity.time}</span>
                        <span>{activity.title}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>

            {trip.notes?.length ? (
              <section className={styles.notes}>
                <h3 className={styles.notesHead}>Notes</h3>
                {trip.notes.map((note) => (
                  <p key={note.id} className={styles.note}>
                    {note.text}
                  </p>
                ))}
              </section>
            ) : null}

            {/* Said once, where the decision is made. A copy is a copy: what
                they do with theirs afterwards is theirs. */}
            <p className={styles.disclosure}>
              Adding this makes your own copy. Bookings do not travel, and later
              changes on either side stay where they are made.
            </p>
          </>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
