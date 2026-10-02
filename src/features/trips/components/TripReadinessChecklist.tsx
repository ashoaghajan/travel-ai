import { Link } from 'react-router-dom';
import { Card } from '../../../components/common/Card';
import type { Booking } from '../../../types/booking.types';
import type { Trip } from '../../../types/trip.types';
import { tripReadiness } from '../../../utils/tripReadiness';
import { toIsoDate } from '../../../utils/date';
import styles from './TripReadinessChecklist.module.css';

export function TripReadinessChecklist({
  trip,
  bookings,
  today = toIsoDate(new Date()),
}: { trip: Trip; bookings: Booking[]; today?: string }) {
  if (trip.startDate && today > trip.startDate) return null;
  const items = tripReadiness(trip, bookings);
  const complete = items.filter((item) => item.complete).length;
  const percentage = Math.round((complete / items.length) * 100);

  return (
    <Card padding="lg" elevation="soft" className={styles.card}>
      <div className={styles.header}>
        <div>
          <h2>Trip readiness</h2>
          <p>{complete} of {items.length} essentials covered</p>
        </div>
        <strong className={styles.percentage}>{percentage}%</strong>
      </div>
      <div className={styles.track} role="progressbar" aria-label="Trip readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={item.complete ? styles.complete : undefined}>
            <span className={styles.mark} aria-hidden="true">{item.complete ? '✓' : '○'}</span>
            <div className={styles.copy}>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <Link to={item.href} aria-label={`${item.complete ? 'Review' : 'Complete'}: ${item.label}`}>
              {item.complete ? 'Review' : 'Add'}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
