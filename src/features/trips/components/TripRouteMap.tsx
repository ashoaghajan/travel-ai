import { MapView } from '../../../components/map/MapView';
import { LazyRouteMap } from '../../../components/map/LazyRouteMap';
import type { RoutePlace } from '../../../components/map/RouteMap';
import type { ItineraryStop } from '../../../utils/trip';
import type { LocatedStop } from '../useStopCoordinates';
import styles from './TripRouteMap.module.css';

export type TripRouteMapProps = {
  /** Every stop, so the placeholder and the accessible name stay complete. */
  stops: ItineraryStop[];
  located: LocatedStop[];
  unlocated: ItineraryStop[];
  /**
   * Hotels and attractions booked for this trip.
   *
   * Drawn as glyphs off the route line — they are places the reader will be,
   * not steps in the itinerary's order. See `useBookingCoordinates`.
   */
  places?: RoutePlace[];
  isLoading: boolean;
  /** Set only when the API key is missing. */
  notice: string | null;
  size?: 'md' | 'lg';
  /** On for the map tab, off in the sticky aside. */
  scrollWheelZoom?: boolean;
};

/**
 * The trip's route, on a real map when it can be, and the stylised placeholder
 * when it cannot.
 *
 * Most trips have no coordinates: the planner writes none, and only attractions
 * picked from the explorer carry any. Rather than showing an empty grey world,
 * an unplottable trip falls back to `MapView` — the card this app has always
 * shipped — with a line explaining why. That keeps the honest answer a designed
 * screen rather than a broken one.
 */
export function TripRouteMap({
  stops,
  located,
  unlocated,
  places = [],
  isLoading,
  notice,
  size = 'md',
  scrollWheelZoom = false,
}: TripRouteMapProps) {
  const total = stops.length;

  // A trip whose only plottable things are its bookings still gets a real map.
  if (located.length === 0 && places.length === 0) {
    return (
      <div className={styles.wrapper}>
        <MapView
          stops={stops}
          size={size}
          caption={isLoading ? 'Finding these places…' : 'Route preview'}
        />
        {isLoading ? null : (
          <p className={styles.note} role="status">
            {notice ?? 'We could not place these stops on a map.'}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <LazyRouteMap
        points={located}
        places={places}
        size={size}
        scrollWheelZoom={scrollWheelZoom}
        // The placeholder shows every stop, so the card does not change shape
        // when the real tiles replace it.
        fallbackStops={stops}
        ariaLabel={
          `Route map with ${located.length} of ${total} stops: ${located
            .map((stop) => stop.label)
            .join(', ')}` +
          (places.length > 0
            ? `. Also ${places.length} booked: ${places.map((place) => place.label).join(', ')}`
            : '')
        }
      />

      {/* A five-pin map of a six-stop trip is explained, never silently wrong. */}
      {unlocated.length > 0 ? (
        <p className={styles.note} role="status">
          {located.length} of {total} stops on the map ·{' '}
          {unlocated.map((stop) => stop.destination).join(', ')} not shown.
        </p>
      ) : null}

      {notice ? (
        <p className={styles.note} role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
