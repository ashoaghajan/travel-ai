import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { ExternalLinkIcon, PlusIcon, StarIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import { formatCurrency } from '../../utils/currency';
import { CATEGORY_IMAGES } from '../../assets/category-images';
import type { Activity } from '../../types/travel.types';
import styles from './ActivityCard.module.css';

export type ActivityCardProps = {
  activity: Activity;
  /** Human label for the activity's category, shown on the photo. */
  categoryLabel?: string;
  /**
   * Makes the whole card open this route.
   *
   * The link wraps the title and is stretched over the card with a pseudo
   * element, rather than wrapping everything: the photo credit is itself a
   * link, and an anchor inside an anchor is invalid and unreachable by
   * keyboard. This way the accessible name is the title, and the credit stays
   * clickable by sitting above the overlay.
   */
  to?: string;
  /**
   * Renders "Add to trip" and "Book" under the card.
   *
   * Supplied on the booking screen, absent in the explorer, which routes
   * through the attraction's own page instead.
   */
  onAddToTrip?: () => void;
  /** Already attached to the trip the screen is filling for. */
  isOnTrip?: boolean;
  /** Where "Book" goes — see `buildActivityUrl`. */
  bookingUrl?: string;
  as?: 'div' | 'li';
  className?: string;
};

/**
 * Activity result (DESIGN_SPEC Screen 6): large photo, title, short
 * description, rating with review count, and the per-person price.
 */
export function ActivityCard({
  activity,
  categoryLabel,
  to,
  onAddToTrip,
  isOnTrip = false,
  bookingUrl,
  as = 'div',
  className,
}: ActivityCardProps) {
  const { title, description, price, rating, reviews, image, category, imageCredit } = activity;

  // Photographs come from Wikimedia, so the URL can rot between the cache
  // being written and the card being drawn. Falling back to the category
  // artwork keeps a broken-image icon out of the middle of the grid — and the
  // credit goes with the photo it belongs to.
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [image]);

  const source = hasFailed ? CATEGORY_IMAGES[category] : image;
  const credit = hasFailed ? undefined : imageCredit;

  return (
    <Card
      as={as}
      padding="none"
      elevation="card"
      className={cx(styles.card, to && styles.clickable, className)}
    >
      <div className={styles.media}>
        <img
          className={styles.image}
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setHasFailed(true)}
        />
        {categoryLabel ? <span className={styles.categoryBadge}>{categoryLabel}</span> : null}
        {credit ? (
          <a
            className={styles.credit}
            href={credit.sourceUrl}
            target="_blank"
            rel="noreferrer nofollow"
            title={`Photo by ${credit.author ?? 'unknown'} — ${credit.license ?? 'see source'}`}
          >
            {[credit.author, credit.license].filter(Boolean).join(' · ')}
          </a>
        ) : null}
      </div>

      <div className={styles.body}>
        <h3 className={styles.title}>
          {to ? (
            <Link className={styles.titleLink} to={to}>
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        <p className={styles.description}>{description}</p>

        {rating > 0 ? (
          <p className={styles.rating}>
            <StarIcon size={14} className={styles.star} />
            <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
            {reviews > 0 ? <span className={styles.reviews}>({reviews})</span> : null}
          </p>
        ) : null}

        {price > 0 ? (
          <p className={styles.priceRow}>
            <span className={styles.price}>{formatCurrency(price)}</span>
            <span className={styles.perPerson}>per person</span>
          </p>
        ) : bookingUrl ? (
          /*
            The listings come from a places directory, which knows where an
            attraction is but not what it costs — `activity.service` hardcodes
            `price: 0` for exactly that reason. Saying where the price lives
            beats an empty space, and matches what `HotelCard` does with an
            unpriced stay. Only shown where there is a partner to point at:
            the explorer has none.
          */
          <p className={styles.unpriced}>Price on partner site</p>
        ) : null}

        {/*
          Above the stretched title link — see `.actions` in the stylesheet.
          Without that these would be unclickable: the overlay covers the whole
          card, which is the same reason the photo credit is raised.
        */}
        {onAddToTrip || bookingUrl ? (
          <div className={styles.actions}>
            {onAddToTrip ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={isOnTrip}
                leadingIcon={isOnTrip ? undefined : <PlusIcon size={16} />}
                onClick={onAddToTrip}
              >
                {isOnTrip ? 'On this trip' : 'Add to trip'}
              </Button>
            ) : null}

            {bookingUrl ? (
              <Button
                variant="primary"
                size="md"
                href={bookingUrl}
                trailingIcon={<ExternalLinkIcon size={16} />}
                // See `FlightResultCard` — `sponsored` is the affiliate value.
                rel="sponsored noopener"
                aria-label={`Book ${title} on our partner's site`}
              >
                Book
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
