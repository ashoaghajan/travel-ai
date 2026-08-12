import { useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '../../../components/common/IconButton';
import { SuitcaseIcon } from '../../../components/common/icons';
import { shareService } from '../../../services/share.service';
import { messagesStore } from '../../../store/messages.store';
import { shareFailureMessage } from '../share.filters';
import { useTrips } from '../../../store/trip.store';
import { createId } from '../../../utils/id';
import { buildTripFile } from '../../../utils/tripFile';
import { formatDateRange } from '../../../utils/date';
import styles from './ShareTripPicker.module.css';

export type ShareTripPickerProps = {
  /** Who the trip would go to — the conversation this composer belongs to. */
  userId: string;
  disabled?: boolean;
};

/**
 * Sends one of your trips without leaving the conversation.
 *
 * The trip screen and the trips list both offer this too, and this is the one
 * that matters in practice: sharing usually comes up mid-sentence, and having
 * to leave the thread, find the trip and come back is how a feature goes
 * unused.
 *
 * Built as the emoji picker is — trigger, popover, dismissal on a click outside
 * or Escape, focus handed back — because it is the same thing: a small chooser
 * hanging off the composer.
 */
export function ShareTripPicker({ userId, disabled = false }: ShareTripPickerProps) {
  const trips = useTrips();
  const [isOpen, setIsOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (isOpen) firstRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  async function share(tripId: string): Promise<void> {
    const trip = trips.find((candidate) => candidate.id === tripId);
    if (!trip) return;

    setSendingId(tripId);
    setError(null);

    try {
      const message = await shareService.shareTrip(
        trip.id,
        userId,
        buildTripFile(trip).trip,
        createId('share'),
      );

      /*
       * Filed straight away rather than waited for.
       *
       * The same message arrives over the channel a moment later and upserts
       * over this by id — but a browser whose realtime is down still has to
       * see what it just sent, and the card should appear under the press.
       */
      messagesStore.receive(message);
      setIsOpen(false);
      triggerRef.current?.focus();
    } catch (caught) {
      setError(shareFailureMessage(caught));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !isOpen) return;

        event.preventDefault();
        // Stopped here, or on a phone this would close the dialog the whole
        // panel sits in rather than the list hanging off the composer.
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <IconButton
        ref={triggerRef}
        label={isOpen ? 'Close trips' : 'Share a trip'}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
      >
        <SuitcaseIcon size={18} />
      </IconButton>

      {isOpen ? (
        <div className={styles.popover} id={listId} role="group" aria-label="Your trips">
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {trips.length === 0 ? (
            <p className={styles.empty}>You have no trips to share yet.</p>
          ) : null}

          <ul className={styles.list}>
            {trips.map((trip, index) => (
              <li key={trip.id}>
                <button
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className={styles.trip}
                  disabled={sendingId !== null}
                  onClick={() => void share(trip.id)}
                >
                  <span className={styles.title}>{trip.title}</span>
                  <span className={styles.meta}>
                    {sendingId === trip.id
                      ? 'Sending…'
                      : formatDateRange(trip.startDate, trip.endDate)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
