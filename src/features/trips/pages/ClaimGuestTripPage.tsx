import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { guestDraftService } from '../../../services/guestDraft.service';
import { tripStore } from '../../../store/trip.store';
import { bookingStore } from '../../../store/booking.store';
import { ROUTES } from '../../../app/routes';
import styles from './ClaimGuestTripPage.module.css';

export function ClaimGuestTripPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(true);

  useEffect(() => {
    let active = true;

    async function claim() {
      const draft = guestDraftService.get();
      if (!draft) {
        navigate(ROUTES.planner, { replace: true });
        return;
      }

      try {
        const trip = await tripStore.saveTrip(draft);
        try {
          await bookingStore.createFromItinerary(trip);
        } catch {
          // Saving the itinerary is the important part; bookings can be rebuilt later.
        }
        guestDraftService.clear();
        if (active) navigate(`/trips/${trip.id}`, { replace: true });
      } catch {
        if (active) {
          setError('Your account is ready, but we could not save the trip yet. Please try again.');
          setIsSaving(false);
        }
      }
    }

    void claim();
    return () => { active = false; };
  }, [navigate]);

  async function retry() {
    setError(null);
    setIsSaving(true);
    const draft = guestDraftService.get();
    if (!draft) {
      navigate(ROUTES.planner, { replace: true });
      return;
    }
    try {
      const trip = await tripStore.saveTrip(draft);
      try { await bookingStore.createFromItinerary(trip); } catch { /* best-effort companion records */ }
      guestDraftService.clear();
      navigate(`/trips/${trip.id}`, { replace: true });
    } catch {
      setError('Your trip is still saved on this device. Please try again.');
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title={isSaving ? 'Saving your itinerary…' : 'Your account is ready'} />
      <div className={styles.content}>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button variant="primary" size="md" onClick={() => void retry()}>Try again</Button>
          </>
        ) : <p role="status">We’re adding your preview to your trips.</p>}
      </div>
    </div>
  );
}
