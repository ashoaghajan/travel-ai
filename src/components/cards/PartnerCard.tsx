import type { CSSProperties } from 'react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { ExternalLinkIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import type { Partner } from '../../types/travel.types';
import styles from './PartnerCard.module.css';

export type PartnerCardProps = {
  partner: Partner;
  as?: 'div' | 'li';
  /** Where View Deals goes — a prefilled search, or the partner's home page. */
  href: string;
  className?: string;
};

/**
 * Partner booking card (DESIGN_SPEC Screen 7): brand-coloured placeholder
 * logo, name, one line of description and a View Deals action.
 *
 * **One action, and only one.** This card used to offer "Add to trip" beside
 * it, which filed a booking titled "Expedia" against the trip — a row with no
 * price, no reference and no flight, sitting in the list where real bookings
 * go. A partner is a shop, not a thing you can book: the only sensible thing
 * to do with one is leave for it. The mobile card never had the second button,
 * so removing it also stops the two platforms disagreeing.
 *
 * Deliberately simpler than a checkout card — booking happens off-app.
 */
export function PartnerCard({
  partner,
  as = 'div',
  href,
  className,
}: PartnerCardProps) {
  const { name, description, brandColor, brandTextColor, initials } = partner;

  const logoStyle = {
    '--partner-color': brandColor,
    '--partner-text-color': brandTextColor,
  } as CSSProperties;

  return (
    <Card as={as} padding="lg" elevation="soft" className={cx(styles.card, className)}>
      <span className={styles.logo} style={logoStyle} aria-hidden="true">
        {initials}
      </span>

      <div className={styles.details}>
        <h3 className={styles.name}>{name}</h3>
        <p className={styles.description}>{description}</p>
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="md"
          className={styles.action}
          trailingIcon={<ExternalLinkIcon size={16} />}
          href={href}
          aria-label={`View deals on ${name}`}
        >
          View Deals
        </Button>
      </div>
    </Card>
  );
}
