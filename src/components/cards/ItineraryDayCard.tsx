import { Card } from '../common/Card';
import { CardImage } from '../common/CardImage';
import { cx } from '../../utils/cx';
import type { ItineraryDay } from '../../types/trip.types';
import styles from './ItineraryDayCard.module.css';

export type ItineraryDayCardProps = {
  day: ItineraryDay;
  as?: 'div' | 'li';
  className?: string;
};

/**
 * Itinerary preview card (DESIGN_SPEC Screen 2): travel image, day number,
 * destination and a short description.
 */
export function ItineraryDayCard({ day, as = 'div', className }: ItineraryDayCardProps) {
  const { dayNumber, destination, summary, image } = day;

  return (
    <Card as={as} padding="none" elevation="soft" className={cx(styles.card, className)}>
      <div className={styles.media}>
        <CardImage
          className={styles.image}
          src={image}
          alt={`${destination}, day ${dayNumber}`}
        />
        <span className={styles.dayBadge}>Day {dayNumber}</span>
      </div>

      <div className={styles.body}>
        <h4 className={styles.destination}>{destination}</h4>
        <p className={styles.description}>{summary}</p>
      </div>
    </Card>
  );
}
