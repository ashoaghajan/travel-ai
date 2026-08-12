import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApiConversation } from '@ai-travel/shared';
import { Avatar } from '../../../components/common/Avatar';
import { IconButton } from '../../../components/common/IconButton';
import { Skeleton } from '../../../components/common/Skeleton';
import { CloseIcon } from '../../../components/common/icons';
import { messagesService } from '../../../services/messages.service';
import { shareService } from '../../../services/share.service';
import { shareFailureMessage } from '../../messages/share.filters';
import type { TripDraft } from '../../../types/trip.types';
import { createId } from '../../../utils/id';
import { buildTripFile } from '../../../utils/tripFile';
import styles from './ShareTripDialog.module.css';

export type ShareTripDialogProps = {
  trip: TripDraft & { id: string };
  onClose: () => void;
};

const LOAD_ERROR = 'We could not load the list of people.';

/**
 * Sends a trip to somebody, from the trip.
 *
 * Here rather than in the messages panel because the thing being acted on is
 * the trip: somebody standing on it and deciding to send it should not have to
 * go and find a conversation first. The panel gets its own way in later —
 * the two share this dialog rather than duplicating it.
 *
 * The snapshot is built here, by `buildTripFile`, which is the same document
 * `Export` writes to a file. That is the whole trick of this feature: the
 * format, its validation and the code that reads it back all existed already.
 */
export function ShareTripDialog({ trip, onClose }: ShareTripDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<ApiConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void messagesService.getConversations().then(
      (list) => {
        if (!cancelled) setPeople(list);
      },
      () => {
        if (!cancelled) setError(LOAD_ERROR);
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  async function share(person: ApiConversation): Promise<void> {
    setSendingTo(person.id);
    setError(null);

    try {
      await shareService.shareTrip(
        trip.id,
        person.id,
        buildTripFile(trip).trip,
        // Minted here so a second press cannot become a second offer — the
        // same protection a written message has, for the same reason.
        createId('share'),
      );
      setSentTo(person.id);
    } catch (caught) {
      setError(shareFailureMessage(caught));
    } finally {
      setSendingTo(null);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label={`Share ${trip.title}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Share this trip</h2>
          <p className={styles.subtitle}>{trip.title}</p>
        </div>

        <IconButton label="Close" onClick={onClose}>
          <CloseIcon size={20} />
        </IconButton>
      </header>

      <div className={styles.body}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {people === null && !error ? (
          <div className={styles.loading} aria-busy="true">
            <span className="visually-hidden">Loading people…</span>
            <Skeleton height="44px" radius="lg" />
            <Skeleton height="44px" radius="lg" />
          </div>
        ) : null}

        {people?.length === 0 ? (
          <p className={styles.empty}>There is nobody else signed up yet.</p>
        ) : null}

        <ul className={styles.people}>
          {people?.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className={styles.person}
                disabled={sendingTo !== null || sentTo === person.id}
                onClick={() => void share(person)}
              >
                <span aria-hidden="true">
                  <Avatar name={person.name} size="sm" />
                </span>
                <span className={styles.name}>{person.name}</span>
                <span className={styles.action}>
                  {sentTo === person.id ? 'Sent' : sendingTo === person.id ? 'Sending…' : 'Send'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/*
          Said once, before the first send, where the decision is made.
          Somebody handing over an itinerary should know what they are handing
          over and what they cannot take back.
        */}
        <p className={styles.disclosure}>
          They get their own copy to accept or ignore. Bookings do not travel, and
          once somebody has added a trip it is theirs — withdrawing only works
          before that.
        </p>
      </div>
    </dialog>,
    document.body,
  );
}
