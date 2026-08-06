import { Button } from '../../../components/common/Button';
import { ItineraryDayCard } from '../../../components/cards/ItineraryDayCard';
import type { TripDraft } from '../../../types/trip.types';
import { formatDateRange } from '../../../utils/date';
import { formatTravellers } from '../../../utils/trip';
import styles from './ItineraryPreview.module.css';

export type ItineraryPreviewProps = {
  trip: TripDraft;
  /** Set once the trip has been saved — unlocks the full itinerary link. */
  savedTripId?: string;
  isSaving?: boolean;
  /*
   * Both handlers are required. They were optional, and "Customise Trip"
   * shipped for months wired to `undefined` — a button that looked live and
   * did nothing, with no type error to catch it. A caller that forgets one
   * should now fail to compile.
   */
  onSave: () => void;
  onCustomise: () => void;
};

/**
 * Horizontal strip of itinerary cards with the follow-up actions
 * (DESIGN_SPEC Screen 2), plus saving the generated trip.
 */
export function ItineraryPreview({
  trip,
  savedTripId,
  isSaving = false,
  onSave,
  onCustomise,
}: ItineraryPreviewProps) {
  return (
    <section className={styles.preview} aria-label={`Suggested schedule for ${trip.title}`}>
      <header className={styles.summary}>
        <h4 className={styles.title}>{trip.title}</h4>
        <p className={styles.meta}>
          {formatDateRange(trip.startDate, trip.endDate)} · {formatTravellers(trip.travellers)}
        </p>
      </header>

      <ul className={styles.row}>
        {trip.itinerary.map((day) => (
          <ItineraryDayCard key={day.id} as="li" day={day} className={styles.card} />
        ))}
      </ul>

      <div className={styles.actions}>
        {savedTripId ? (
          <Button to={`/trips/${savedTripId}`} variant="primary" size="md">
            View Full Itinerary
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={onSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save Trip'}
          </Button>
        )}

        <Button variant="secondary" size="md" onClick={onCustomise}>
          Customise Trip
        </Button>
      </div>

      {savedTripId ? (
        <p className={styles.savedNote} role="status">
          Saved to your trips.
        </p>
      ) : null}
    </section>
  );
}
