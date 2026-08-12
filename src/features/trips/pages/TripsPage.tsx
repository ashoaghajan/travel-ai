import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { TripCard } from '../../../components/cards/TripCard';
import {
  PlusIcon,
  SparklesIcon,
  SuitcaseIcon,
  UploadIcon,
} from '../../../components/common/icons';
import { formatDayCount } from '../../../utils/trip';
import { useActiveTripId } from '../../../store/trip.store';
import { useBookingsByTrip } from '../../../store/booking.store';
import { EditTripModal } from '../components/EditTripModal';
import { ShareTripDialog } from '../components/ShareTripDialog';
import { ImportTripDialog } from '../components/ImportTripDialog';
import { useSavedTrips } from '../useTrips';
import styles from './TripsPage.module.css';

const SKELETON_COUNT = 3;

function TripCardSkeleton() {
  return (
    <Card padding="none" elevation="card" className={styles.skeletonCard}>
      <Skeleton height="150px" radius="sm" className={styles.skeletonMedia} />
      <div className={styles.skeletonBody}>
        <Skeleton width="65%" height="18px" />
        <Skeleton width="45%" height="12px" />
        <Skeleton width="35%" height="12px" />
      </div>
    </Card>
  );
}

/**
 * Saved trips list. Data is persisted in localStorage through `tripService`,
 * so trips saved from the planner show up here.
 */
export function TripsPage() {
  const { trips, error, deletingTripId, isLoading, deleteTrip } = useSavedTrips();

  // Grouped once for the whole grid rather than filtered per card.
  const bookingsByTrip = useBookingsByTrip();

  // The trip being edited is held by id, not by value: the store hands back a
  // new object on every save, and a stale copy would reopen the old itinerary.
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [sharingTripId, setSharingTripId] = useState<string | null>(null);
  const editingTrip = trips.find((trip) => trip.id === editingTripId);
  const sharingTrip = trips.find((trip) => trip.id === sharingTripId);

  const [isImporting, setIsImporting] = useState(false);
  const navigate = useNavigate();

  // Restored from storage, so it survives a reload.
  const activeTripId = useActiveTripId();
  const activeTrip = trips.find((trip) => trip.id === activeTripId);

  const subtitle = isLoading
    ? 'Loading your trips…'
    : `${trips.length} saved ${trips.length === 1 ? 'trip' : 'trips'}`;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Your Trips"
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<UploadIcon size={18} />}
              onClick={() => setIsImporting(true)}
            >
              Import trip
            </Button>
            <Button
              to={ROUTES.planner}
              variant="secondary"
              size="md"
              leadingIcon={<SparklesIcon size={18} />}
            >
              Plan with AI
            </Button>
            <Button
              to={ROUTES.tripNew}
              variant="primary"
              size="md"
              leadingIcon={<PlusIcon size={18} />}
            >
              New Trip
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        {activeTrip && trips.length > 1 ? (
          <Link to={`/trips/${activeTrip.id}`} className={styles.resume}>
            <span className={styles.resumeLabel}>Continue where you left off</span>
            <span className={styles.resumeTitle}>{activeTrip.title}</span>
          </Link>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className={styles.grid} aria-busy="true">
            <span className="visually-hidden">Loading your saved trips…</span>
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <TripCardSkeleton key={index} />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <EmptyState
            icon={<SuitcaseIcon size={26} />}
            title="No saved trips yet"
            description="Start one yourself and fill in the days as you go, or describe what you want and let the planner draft it."
            action={
              <>
                <Button to={ROUTES.tripNew} variant="primary" size="md">
                  New Trip
                </Button>
                <Button to={ROUTES.planner} variant="secondary" size="md">
                  Plan with AI
                </Button>
                {/* Someone arriving with a file in hand has no trips yet, so
                    this is exactly where they will look for it. */}
                <Button variant="secondary" size="md" onClick={() => setIsImporting(true)}>
                  Import a trip
                </Button>
              </>
            }
          />
        ) : (
          <ul className={styles.grid}>
            {trips.map((trip) => (
              <TripCard
                key={trip.id}
                as="li"
                trip={trip}
                bookings={bookingsByTrip.get(trip.id) ?? []}
                onDelete={(target) => void deleteTrip(target)}
                onEdit={(target) => setEditingTripId(target.id)}
                onShare={(target) => setSharingTripId(target.id)}
                isDeleting={deletingTripId === trip.id}
              />
            ))}
          </ul>
        )}

        {!isLoading && trips.length > 0 ? (
          <p className={styles.footnote}>
            {formatDayCount(trips.reduce((total, trip) => total + trip.itinerary.length, 0))}{' '}
            planned across {trips.length === 1 ? 'this trip' : 'these trips'}.
          </p>
        ) : null}
      </div>

      {editingTrip ? (
        <EditTripModal trip={editingTrip} onClose={() => setEditingTripId(null)} />
      ) : null}

      {sharingTrip ? (
        <ShareTripDialog trip={sharingTrip} onClose={() => setSharingTripId(null)} />
      ) : null}

      {isImporting ? (
        <ImportTripDialog
          onClose={() => setIsImporting(false)}
          onImported={(trip) => {
            setIsImporting(false);
            // Onto the trip itself: it is already in the store, so this needs
            // no fetch, and landing on it is the proof the import worked.
            void navigate(`/trips/${trip.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
