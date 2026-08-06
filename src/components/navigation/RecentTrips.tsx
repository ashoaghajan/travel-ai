import { Link } from 'react-router-dom';
import type { Trip } from '../../types/trip.types';
import { formatDateRange } from '../../utils/date';
import styles from './RecentTrips.module.css';

export type RecentTripsProps = {
  trips: Trip[];
};

/** Sidebar "Recent Trips" list (DESIGN_SPEC Screen 2), from saved trips. */
export function RecentTrips({ trips }: RecentTripsProps) {
  return (
    <section className={styles.section} aria-labelledby="sidebar-recent-trips">
      <h2 id="sidebar-recent-trips" className={styles.heading}>
        Recent Trips
      </h2>

      {trips.length === 0 ? (
        <p className={styles.empty}>Trips you save will appear here.</p>
      ) : (
        <ul className={styles.list}>
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link to={`/trips/${trip.id}`} className={styles.item}>
                <span className={styles.title}>{trip.title}</span>
                <span className={styles.dates}>
                  {formatDateRange(trip.startDate, trip.endDate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
