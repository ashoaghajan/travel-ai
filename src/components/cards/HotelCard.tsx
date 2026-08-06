import { useState } from 'react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { ExternalLinkIcon, MapPinIcon, StarIcon, PlusIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import { formatCurrency } from '../../utils/currency';
import type { Hotel } from '../../types/travel.types';
import styles from './HotelCard.module.css';

export type HotelCardProps = {
  hotel: Hotel;
  as?: 'div' | 'li';
  /** Renders "Add to trip" beside Book — see `FlightResultCardProps`. */
  onAddToTrip?: () => void;
  /** Already attached to the trip the screen is filling for. */
  isOnTrip?: boolean;
  /**
   * Every night of the trip already has a bed booked.
   *
   * Distinct from `isOnTrip`, which is about *this* hotel: a reader can be
   * fully booked while looking at a hotel they have never saved, and the
   * reason they cannot add it is the trip's, not the hotel's.
   */
  isFullyBooked?: boolean;
  className?: string;
};

/**
 * Hotel result (DESIGN_SPEC Screen 5): image-heavy, stacked on mobile and
 * image-left from 768px, with the nightly price aligned right.
 *
 * The booking action is a button rather than the whole card being a link:
 * wrapping an anchor around the photograph, the name, the rating and the price
 * would give a screen reader one link whose name is all of that read aloud.
 */
export function HotelCard({
  hotel,
  as = 'div',
  onAddToTrip,
  isOnTrip = false,
  isFullyBooked = false,
  className,
}: HotelCardProps) {
  const { name, location, category, rating, reviews, pricePerNight, image, bookingUrl } = hotel;
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <Card as={as} padding="none" elevation="card" className={cx(styles.card, className)}>
      {/*
        A real listing carries no photograph — the places directory has none.
        The placeholder tile keeps the card's shape rather than collapsing it,
        and a broken <img> is worse than no <img>.

        The placeholder is drawn underneath rather than instead of the photo,
        because the provider's images are slow: a card whose picture is still
        in flight showed a bare tinted box for several seconds, which reads as
        a card that failed rather than one still arriving. It also catches a
        URL that has rotted, without a second render path for the failure.
      */}
      <div className={styles.media}>
        <span className={styles.mediaPlaceholder} aria-hidden="true">
          <MapPinIcon size={22} />
        </span>

        {image && !imageFailed ? (
          <img
            className={styles.image}
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : null}
      </div>

      <div className={styles.body}>
        <div className={styles.details}>
          <h3 className={styles.name}>{name}</h3>
          <p className={styles.category}>
            {category} · {location}
          </p>

          {/* Zero means unrated, not badly rated — so show nothing. */}
          {rating > 0 ? (
            <p className={styles.rating}>
              <StarIcon size={14} className={styles.star} />
              <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
              {reviews > 0 ? <span className={styles.reviews}>({reviews})</span> : null}
            </p>
          ) : null}
        </div>

        <div className={styles.priceRow}>
          {/*
            No invented number when nothing has quoted one. The partner is
            where the rate lives, and saying so is more use than a blank.
          */}
          {pricePerNight === null ? (
            <p className={styles.unpriced}>Price on partner site</p>
          ) : (
            <p className={styles.priceGroup}>
              <span className={styles.price}>{formatCurrency(pricePerNight)}</span>
              <span className={styles.perNight}>/ night</span>
            </p>
          )}

          {onAddToTrip ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isOnTrip || isFullyBooked}
              leadingIcon={isOnTrip || isFullyBooked ? undefined : <PlusIcon size={16} />}
              onClick={onAddToTrip}
              title={
                isFullyBooked && !isOnTrip
                  ? 'Every night of this trip already has a stay booked.'
                  : undefined
              }
            >
              {isOnTrip ? 'On this trip' : isFullyBooked ? 'Every night booked' : 'Add to trip'}
            </Button>
          ) : null}

          {bookingUrl ? (
            <Button
              variant="primary"
              size="md"
              className={styles.book}
              href={bookingUrl}
              trailingIcon={<ExternalLinkIcon size={16} />}
              // See `FlightResultCard` — `sponsored` is the affiliate value.
              rel="sponsored noopener"
              aria-label={
                pricePerNight === null
                  ? `Check prices for ${name} in ${location}, on our partner's site`
                  : `Book ${name} at ${formatCurrency(pricePerNight)} a night, on our partner's site`
              }
            >
              {pricePerNight === null ? 'Check price' : 'Book'}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
