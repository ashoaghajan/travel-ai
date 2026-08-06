import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Avatar } from '../../../components/common/Avatar';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { TripCard } from '../../../components/cards/TripCard';
import { SuitcaseIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { authStore } from '../../../store/auth.store';
import { useTrips } from '../../../store/trip.store';
import { useBookingsByTrip } from '../../../store/booking.store';
import { ConnectedAccounts } from '../components/ConnectedAccounts';
import styles from './ProfilePage.module.css';

const RECENT_TRIPS_LIMIT = 3;

const SIGN_OUT_ERROR = 'We could not sign you out. Please try again.';

export function ProfilePage() {
  const trips = useTrips();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    setNotice(null);

    try {
      await authStore.signOut();
      navigate(ROUTES.login, { replace: true });
    } catch {
      // `signOut` clears the local session even when the server call fails, so
      // reaching here means something stranger — say so rather than pretending.
      setNotice(SIGN_OUT_ERROR);
      setIsSigningOut(false);
    }
  }

  const stats = useMemo(() => {
    const days = trips.reduce((total, trip) => total + trip.itinerary.length, 0);
    const destinations = new Set(trips.map((trip) => trip.destination));

    return [
      { id: 'trips', value: trips.length, label: trips.length === 1 ? 'Saved trip' : 'Saved trips' },
      { id: 'days', value: days, label: days === 1 ? 'Day planned' : 'Days planned' },
      {
        id: 'destinations',
        value: destinations.size,
        label: destinations.size === 1 ? 'Destination' : 'Destinations',
      },
    ];
  }, [trips]);

  const recentTrips = trips.slice(0, RECENT_TRIPS_LIMIT);
  const bookingsByTrip = useBookingsByTrip();

  return (
    <div className={styles.page}>
      <PageHeader title="Profile" />

      <div className={styles.content}>
        <Card padding="lg" elevation="card" className={styles.identity}>
          <Avatar name={user?.name ?? ''} size="lg" />

          <div className={styles.identityText}>
            <p className={styles.name}>{user?.name}</p>
            <p className={styles.identityMeta}>{user?.email}</p>
          </div>

          <Button
            variant="secondary"
            size="md"
            className={styles.signIn}
            onClick={signOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </Card>

        <p className={styles.status} role="status">
          {notice}
        </p>

        <ConnectedAccounts />

        <ul className={styles.stats}>
          {stats.map((stat) => (
            <li key={stat.id}>
              <Card padding="lg" elevation="soft" className={styles.stat}>
                <span className={styles.statValue}>{stat.value}</span>
                <span className={styles.statLabel}>{stat.label}</span>
              </Card>
            </li>
          ))}
        </ul>

        <section className={styles.trips} aria-labelledby="profile-recent-trips">
          <header className={styles.tripsHeader}>
            <h2 id="profile-recent-trips" className={styles.tripsTitle}>
              Recent trips
            </h2>
            {trips.length > RECENT_TRIPS_LIMIT ? (
              <Link to={ROUTES.trips} className={styles.viewAll}>
                View all
              </Link>
            ) : null}
          </header>

          {recentTrips.length === 0 ? (
            <EmptyState
              icon={<SuitcaseIcon size={26} />}
              title="No saved trips yet"
              description="Trips you create or save show up here and in your trips list."
              action={
                <>
                  <Button to={ROUTES.tripNew} variant="primary" size="md">
                    New Trip
                  </Button>
                  <Button to={ROUTES.planner} variant="secondary" size="md">
                    Plan with AI
                  </Button>
                </>
              }
            />
          ) : (
            <ul className={styles.tripGrid}>
              {recentTrips.map((trip) => (
                <TripCard
                  key={trip.id}
                  as="li"
                  trip={trip}
                  bookings={bookingsByTrip.get(trip.id) ?? []}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
