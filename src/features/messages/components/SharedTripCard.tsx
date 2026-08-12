import { Link } from 'react-router-dom';
import type { ApiTripShare } from '@ai-travel/shared';
import { Button } from '../../../components/common/Button';
import { MapPinIcon } from '../../../components/common/icons';
import { cx } from '../../../utils/cx';
import styles from './SharedTripCard.module.css';

export type SharedTripCardProps = {
  share: ApiTripShare;
  /** Whether the reader is the one who offered it. */
  isOwn: boolean;
  onPreview: () => void;
  onAccept: () => void;
  onRevoke: () => void;
  isBusy?: boolean;
};

/**
 * "Sep 7 – 11", or whatever the reader's locale makes of a range.
 *
 * `formatRange` rather than two formatted dates joined by a dash: it is the
 * one thing that knows the month goes once and which end it belongs to, and
 * that answer differs by locale. Hand-joining produced "7 – Sep 11".
 */
function dateRange(startDate: string, endDate: string): string {
  // Parsed as local midnight, not UTC: a trip's dates are calendar days, and
  // `new Date('2026-09-07')` is midnight UTC — which is the 6th in the Americas.
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  const format = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

  return typeof format.formatRange === 'function'
    ? format.formatRange(start, end)
    : `${format.format(start)} – ${format.format(end)}`;
}

/**
 * A trip somebody offered, in the thread where they offered it.
 *
 * Four states, and they are the feature. **Offered**: preview it, take it up,
 * or (if you sent it) withdraw it. **Accepted**: it is a trip now, and the
 * recipient's card links to it. **Withdrawn**: it says so and does nothing —
 * the card stays rather than vanishing, because a message disappearing from
 * somebody's screen is worse than one that explains itself.
 *
 * Each state says something different depending on which end you are, which is
 * why `isOwn` runs through all of it: "Added to your trips" and "Added to their
 * trips" are the same fact and not the same sentence.
 */
export function SharedTripCard({
  share,
  isOwn,
  onPreview,
  onAccept,
  onRevoke,
  isBusy = false,
}: SharedTripCardProps) {
  const isAccepted = Boolean(share.acceptedAt);
  const isRevoked = Boolean(share.revokedAt) && !isAccepted;

  return (
    <article className={cx(styles.card, isRevoked && styles.revoked)}>
      <h4 className={styles.title}>{share.title}</h4>

      <p className={styles.meta}>
        {share.destination ? (
          <span className={styles.where}>
            <MapPinIcon size={14} aria-hidden="true" />
            {share.destination}
          </span>
        ) : null}
        <span>{dateRange(share.startDate, share.endDate)}</span>
        <span>
          {share.dayCount} {share.dayCount === 1 ? 'day' : 'days'}
        </span>
      </p>

      {isRevoked ? (
        <p className={styles.status}>
          {isOwn ? 'You withdrew this trip.' : 'This trip is no longer being shared.'}
        </p>
      ) : isAccepted ? (
        <p className={styles.status}>
          {isOwn ? (
            'Added to their trips.'
          ) : share.acceptedTripId ? (
            <>
              Added to your trips.{' '}
              <Link className={styles.link} to={`/trips/${share.acceptedTripId}`}>
                Open it
              </Link>
            </>
          ) : (
            'Added to your trips.'
          )}
        </p>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" size="md" onClick={onPreview}>
            Preview
          </Button>

          {/* The sender never accepts their own offer, and the recipient never
              withdraws one — the same card, two different verbs. */}
          {isOwn ? (
            <button type="button" className={styles.textAction} disabled={isBusy} onClick={onRevoke}>
              Withdraw
            </button>
          ) : (
            <Button variant="primary" size="md" disabled={isBusy} onClick={onAccept}>
              {isBusy ? 'Adding…' : 'Add to my trips'}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
