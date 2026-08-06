import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../common/Card';
import { CardImage } from '../common/CardImage';
import { Button } from '../common/Button';
import { IconButton } from '../common/IconButton';
import { CalendarIcon, MapPinIcon, TrashIcon, UsersIcon, WalletIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import { formatDateRange } from '../../utils/date';
import { formatDayCount, formatTravellers, formatTripTotal, tripTotal } from '../../utils/trip';
import type { Booking } from '../../types/booking.types';
import type { Trip } from '../../types/trip.types';
import styles from './TripCard.module.css';

export type TripCardProps = {
  trip: Trip;
  /**
   * The trip's bookings, for the cost row.
   *
   * Required rather than optional: `tripTotal(trip, [])` falls back to the
   * planner's estimate, so a caller that forgot to pass them would get a
   * plausible-looking wrong number instead of an obvious blank. Pass `[]` to
   * mean "this trip genuinely has none".
   */
  bookings: Booking[];
  as?: 'div' | 'li';
  /** Omit to render a card without the delete control. */
  onDelete?: (trip: Trip) => void;
  /** Omit to render a card without the edit control. */
  onEdit?: (trip: Trip) => void;
  isDeleting?: boolean;
  className?: string;
};

/**
 * Saved trip summary. The whole card is a link to the trip; the delete control
 * sits above that overlay so it stays independently clickable.
 */
export function TripCard({
  trip,
  bookings,
  as = 'div',
  onDelete,
  onEdit,
  isDeleting = false,
  className,
}: TripCardProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const total = formatTripTotal(tripTotal(trip, bookings));

  return (
    <Card as={as} padding="none" elevation="card" className={cx(styles.card, className)}>
      <div className={styles.media}>
        <CardImage className={styles.image} src={trip.coverImage} />
        <span className={styles.dayBadge}>{formatDayCount(trip.itinerary.length)}</span>

      </div>

      <div className={styles.body}>
        <h3 className={styles.title}>
          <Link to={`/trips/${trip.id}`} className={styles.link}>
            {trip.title}
          </Link>
        </h3>

        <p className={styles.meta}>
          <CalendarIcon size={14} />
          {formatDateRange(trip.startDate, trip.endDate)}
        </p>
        <p className={styles.meta}>
          <UsersIcon size={14} />
          {formatTravellers(trip.travellers)}
        </p>
        <p className={styles.meta}>
          <MapPinIcon size={14} />
          {trip.destination}
        </p>
        {/* Dropped entirely when nothing is priced, so a new trip keeps the
            three-row height rather than showing a hollow $0. */}
        {total ? (
          <p className={styles.meta}>
            <WalletIcon size={14} />
            {total}
          </p>
        ) : null}

        {/* Above the title's stretched link, so each stays independently clickable. */}
        <div className={styles.actions}>
          <Button to={`/trips/${trip.id}`} variant="secondary" size="md">
            View
          </Button>
          {onEdit ? (
            <Button variant="secondary" size="md" onClick={() => onEdit(trip)}>
              Edit
            </Button>
          ) : null}
          {/*
            Quiet, and pushed away from the other two.
            This press only opens the confirm below — it destroys nothing — so
            it does not need the weight. A filled red button beside View and
            Edit made deleting the loudest thing on a card whose job is to be
            opened, and put it a slipped click from Edit. The red is spent
            where it belongs, on the confirm that actually does it.
          */}
          {onDelete ? (
            <IconButton
              label={`Delete ${trip.title}`}
              className={styles.delete}
              disabled={isDeleting}
              onClick={() => setIsConfirming(true)}
            >
              <TrashIcon size={18} />
            </IconButton>
          ) : null}
        </div>
      </div>

      {isConfirming ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>Delete this trip?</p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" size="md" onClick={() => setIsConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={isDeleting}
              onClick={() => onDelete?.(trip)}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
