import { Link } from 'react-router-dom';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { CalendarIcon, CompassIcon, TicketIcon } from '../../../components/common/icons';
import type { Booking } from '../../../types/booking.types';
import type { ItineraryDay, Trip } from '../../../types/trip.types';
import { formatShortDate, fromIsoDate, nightsBetween, toIsoDate } from '../../../utils/date';
import { bookingKindLabel, bookingsOnDay } from '../../../utils/booking';
import styles from './TripAtAGlance.module.css';

function tripPhase(trip: Trip, today: string): { title: string; detail: string } {
  if (today < trip.startDate) {
    const daysUntil = Math.ceil((fromIsoDate(trip.startDate).getTime() - fromIsoDate(today).getTime()) / 86_400_000);
    return {
      title: daysUntil === 0 ? 'Your trip starts today' : `Your trip starts in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`,
      detail: `${formatShortDate(trip.startDate)} · ${nightsBetween(trip.startDate, trip.endDate)} nights`,
    };
  }
  if (today <= trip.endDate) {
    return { title: 'You’re on this trip', detail: `Day ${nightsBetween(trip.startDate, today) + 1} of ${trip.itinerary.length}` };
  }
  return { title: 'Trip completed', detail: `${formatShortDate(trip.startDate)} – ${formatShortDate(trip.endDate)}` };
}

function nextDay(days: ItineraryDay[], today: string): ItineraryDay | null {
  return days.find((day) => day.date >= today) ?? null;
}

export type TripAtAGlanceProps = {
  trip: Trip;
  bookings: Booking[];
  today?: string;
  currentTime?: string;
  offlineReadOnly?: boolean;
};

/** Compact travel-day entry point: status, the next schedule item, and key actions. */
export function TripAtAGlance({
  trip,
  bookings,
  today = toIsoDate(new Date()),
  currentTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
  offlineReadOnly = false,
}: TripAtAGlanceProps) {
  const phase = tripPhase(trip, today);
  const day = nextDay(trip.itinerary, today);
  const dayBookings = day ? bookingsOnDay(bookings, day.date) : [];
  const nextActivity = day?.activities.find((activity) =>
    day.date > today || activity.time >= currentTime,
  );

  return (
    <Card padding="lg" elevation="soft" className={styles.card}>
      <div className={styles.top}>
        <div className={styles.phase}>
          <CalendarIcon size={18} />
          <div>
            <h2>{phase.title}</h2>
            <p>{phase.detail}</p>
          </div>
        </div>
        {!offlineReadOnly ? (
          <div className={styles.actions}>
            <Button to={`/bookings?tripId=${encodeURIComponent(trip.id)}`} variant="secondary" size="md" leadingIcon={<TicketIcon size={16} />}>
              Manage bookings
            </Button>
            <Button to={`/activities?tripId=${encodeURIComponent(trip.id)}`} variant="secondary" size="md" leadingIcon={<CompassIcon size={16} />}>
              Find places
            </Button>
          </div>
        ) : null}
      </div>

      {day ? (
        <div className={styles.next}>
          <div>
            <p className={styles.kicker}>{day.date === today ? 'Up next today' : `Next · ${formatShortDate(day.date)}`}</p>
            <h3>Day {day.dayNumber} in {day.destination}</h3>
            {nextActivity ? <p className={styles.item}>{nextActivity.time} · {nextActivity.title}</p> : null}
            {dayBookings.length ? (
              <ul className={styles.bookingList}>
                {dayBookings.slice(0, 2).map(({ booking, moment }) => (
                  <li key={`${booking.id}-${moment}`}>
                    {bookingKindLabel(booking.kind)} · {booking.title}
                  </li>
                ))}
              </ul>
            ) : null}
            {!nextActivity && dayBookings.length === 0 ? <p className={styles.item}>Nothing scheduled yet.</p> : null}
          </div>
          <Link className={styles.scheduleLink} to={`/trips/${encodeURIComponent(trip.id)}?tab=itinerary`}>
            Open schedule
          </Link>
        </div>
      ) : (
        <div className={styles.next}>
          <div>
            <p className={styles.kicker}>Your schedule</p>
            <h3>{trip.itinerary.length ? 'No upcoming days' : 'Nothing scheduled yet'}</h3>
            <p className={styles.item}>Add places to your itinerary or check your bookings.</p>
          </div>
          <Link className={styles.scheduleLink} to={`/trips/${encodeURIComponent(trip.id)}?tab=itinerary`}>
            Open schedule
          </Link>
        </div>
      )}
    </Card>
  );
}
