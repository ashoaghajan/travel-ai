import { Card } from '../common/Card';
import { CardImage } from '../common/CardImage';
import { Button } from '../common/Button';
import { cx } from '../../utils/cx';
import { formatCurrency } from '../../utils/currency';
import { formatDateRange } from '../../utils/date';
import {
  calculateTripCosts,
  formatNightCount,
  formatTravellers,
  tripPricing,
  tripTotal,
} from '../../utils/trip';
import { bookingTotals } from '../../utils/booking';
import type { TripPricing } from '../../utils/booking';
import type { Booking, BookingKind } from '../../types/booking.types';
import type { Trip } from '../../types/trip.types';
import styles from './TripSummaryCard.module.css';

export type TripSummaryCardProps = {
  trip: Trip;
  /** The trip's bookings. Required, on the same reasoning as `TripCard`. */
  bookings: Booking[];
  onSave?: () => void;
  isSaving?: boolean;
  isSaved?: boolean;
  onShare?: () => void;
  className?: string;
};

type CostRow = {
  id: string;
  label: string;
  amount: number;
};

/** How the three rows read when they are made of real saved bookings. */
const KIND_ROWS: { id: string; label: string; kinds: BookingKind[] }[] = [
  { id: 'flights', label: 'Flights', kinds: ['flight'] },
  { id: 'hotels', label: 'Stays', kinds: ['hotel'] },
  // `ticket` is only ever produced by a manual add, and a ticket is a thing to
  // do — it belongs with activities rather than in a row of its own.
  { id: 'activities', label: 'Activities', kinds: ['activity', 'ticket'] },
];

/**
 * The same three rows, priced from what the reader actually saved.
 *
 * A row with nothing in it is dropped rather than shown as $0: a trip with no
 * flights saved has not been quoted $0 for flights, it simply has none yet.
 */
function kindRows(bookings: Booking[], pricing: TripPricing): CostRow[] {
  return KIND_ROWS.flatMap(({ id, label, kinds }) => {
    const matching = bookings.filter((booking) => kinds.includes(booking.kind));
    const { total, priced } = bookingTotals(matching, pricing);

    if (priced === 0) return [];

    return [{ id, label: `${label} ${priced}`, amount: total }];
  });
}

/**
 * Checkout-style trip summary (DESIGN_SPEC Screen 8): cover image, trip
 * identity, the three estimate rows, a larger bold total, and the two actions.
 *
 * Every figure is derived from the trip — nothing here is hard-coded.
 */
export function TripSummaryCard({
  trip,
  bookings,
  onSave,
  isSaving = false,
  isSaved = false,
  onShare,
  className,
}: TripSummaryCardProps) {
  const costs = calculateTripCosts(trip);
  const total = tripTotal(trip, bookings);

  /*
   * Which of the two totals this card is showing.
   *
   * The estimate rows describe a plan the planner guessed at; once the reader
   * has saved a fare or a stay with a price on it, that guess is no longer the
   * best answer available and the card says so rather than quietly keeping the
   * old number under a heading that reads "Total".
   */
  const fromBookings = total.basis === 'bookings';

  const rows: CostRow[] = fromBookings
    ? kindRows(bookings, tripPricing(trip))
    : [
        { id: 'flights', label: 'Flights', amount: costs.flights },
        { id: 'hotels', label: `Hotels ${formatNightCount(costs.nights)}`, amount: costs.hotels },
        { id: 'activities', label: `Activities ${costs.activityCount}`, amount: costs.activities },
      ];

  return (
    <Card padding="none" elevation="card" className={cx(styles.card, className)}>
      <div className={styles.media}>
        <CardImage className={styles.image} src={trip.coverImage} />
      </div>

      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>{trip.title}</h2>
          <p className={styles.meta}>
            {formatDateRange(trip.startDate, trip.endDate)} · {formatTravellers(trip.travellers)}
          </p>
        </header>

        {/* Nothing priced at all — which is every hand-made trip until
            something is saved to it. Three $0 rows under a confident bold
            "Total USD $0" would be a number the reader could act on. */}
        {total.basis === 'none' ? (
          <p className={styles.disclaimer}>
            No prices yet. Add a flight, a stay or something to do and the total appears here.
          </p>
        ) : (
          <>
            <dl className={styles.costs}>
              {rows.map((row) => (
                <div key={row.id} className={styles.row}>
                  <dt className={styles.label}>{row.label}</dt>
                  <dd className={styles.value}>{formatCurrency(row.amount)}</dd>
                </div>
              ))}

              <div className={cx(styles.row, styles.totalRow)}>
                <dt className={styles.totalLabel}>Total USD</dt>
                <dd className={styles.totalValue}>{formatCurrency(total.amount)}</dd>
              </div>
            </dl>

            <p className={styles.disclaimer}>
              {fromBookings
                ? `This is what you have saved for this trip.${
                    total.counted > total.priced
                      ? ` ${total.counted - total.priced} more ${
                          total.counted - total.priced === 1 ? 'booking has' : 'bookings have'
                        } no price yet.`
                      : ''
                  }`
                : 'Estimates only. Prices are confirmed with our partners at booking.'}
            </p>
          </>
        )}

        <div className={styles.actions}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={onSave}
            disabled={isSaving || isSaved}
          >
            {isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save Trip'}
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={onShare}>
            Share Trip
          </Button>
        </div>
      </div>
    </Card>
  );
}
