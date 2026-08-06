import type { CSSProperties } from 'react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { ExternalLinkIcon, PlusIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import type { Partner } from '../../types/travel.types';
import styles from './PartnerCard.module.css';

export type PartnerCardProps = {
  partner: Partner;
  as?: 'div' | 'li';
  /** Where View Deals goes — a prefilled search, or the partner's home page. */
  href: string;
  /** Renders "Add to trip" beside View Deals — see `FlightResultCardProps`. */
  onAddToTrip?: () => void;
  className?: string;
};

/**
 * Partner booking card (DESIGN_SPEC Screen 7): brand-coloured placeholder
 * logo, name, one line of description and a View Deals action.
 *
 * Deliberately simpler than a checkout card — booking happens off-app.
 */
export function PartnerCard({
  partner,
  as = 'div',
  href,
  onAddToTrip,
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
        {onAddToTrip ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            leadingIcon={<PlusIcon size={16} />}
            onClick={onAddToTrip}
            aria-label={`Add ${name} to a trip`}
          >
            Add to trip
          </Button>
        ) : null}

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
