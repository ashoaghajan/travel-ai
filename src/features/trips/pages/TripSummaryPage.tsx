import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { TripSummaryCard } from '../../../components/cards/TripSummaryCard';
import { useTripBookings } from '../../../store/booking.store';
import { SuitcaseIcon } from '../../../components/common/icons';
import { BackLink } from '../components/BackLink';
import { useTripDetails, useTripSave } from '../useTrips';
import styles from './TripSummaryPage.module.css';

const SHARE_NOTE =
  'Sharing is not available yet. In Stage 1 your trips stay on this device.';

/** Screen 8 — Trip Summary (DESIGN_SPEC §8). */
export function TripSummaryPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const { trip, isLoading, notFound } = useTripDetails(tripId);
  const { save, error, isSaving, isSaved } = useTripSave(tripId);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // Above the early returns below, because a hook cannot be conditional. An
  // empty id matches no booking, which is the right answer while loading.
  const bookings = useTripBookings(tripId ?? '');

  const backTo = tripId ? `/trips/${tripId}` : ROUTES.trips;

  if (isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Trip Summary" leading={<BackLink to={backTo} label="Back to trip" />} />
        <div className={styles.content} aria-busy="true">
          <span className="visually-hidden">Loading this trip…</span>
          <Skeleton height="200px" radius="lg" />
          <Skeleton height="180px" radius="lg" />
        </div>
      </div>
    );
  }

  if (notFound || !trip) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Trip Summary"
          leading={<BackLink to={ROUTES.trips} label="Back to your trips" />}
        />
        <div className={styles.content}>
          <EmptyState
            icon={<SuitcaseIcon size={26} />}
            title="This trip is no longer saved"
            description="It may have been deleted. Your other saved trips are still here."
            action={
              <Button to={ROUTES.trips} variant="primary" size="md">
                Back to trips
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Trip Summary"
        subtitle={trip.title}
        leading={<BackLink to={backTo} label="Back to trip" />}
      />

      <div className={styles.content}>
        <TripSummaryCard
          trip={trip}
          bookings={bookings}
          onSave={() => void save()}
          isSaving={isSaving}
          isSaved={isSaved}
          onShare={() => setShareNote(SHARE_NOTE)}
        />

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <p className={styles.status} role="status">
          {isSaved ? 'Saved to your trips.' : shareNote}
        </p>
      </div>
    </div>
  );
}
