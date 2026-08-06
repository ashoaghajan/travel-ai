import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { ExternalLinkIcon, PlusIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import { formatCurrency } from '../../utils/currency';
import { formatStops } from '../../utils/duration';
import { formatShortDate } from '../../utils/date';
import type { Flight } from '../../types/travel.types';
import styles from './FlightResultCard.module.css';

export type FlightResultCardProps = {
  flight: Flight;
  as?: 'div' | 'li';
  /**
   * Renders "Add to trip" beside Book.
   *
   * Two separate actions on purpose: Book leaves for the partner, this records
   * the choice here. Nothing is inferred from the redirect, because the partner
   * never tells us whether the checkout completed.
   *
   * Omit it and the card renders exactly as it always did.
   */
  onAddToTrip?: () => void;
  /** Already attached to the trip the screen is filling for. */
  isOnTrip?: boolean;
  className?: string;
};

/** Airline initials stand in for a logo (DESIGN_SPEC Screen 4). */
function airlineInitials(airline: string): string {
  return airline
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * One flight result (DESIGN_SPEC Screen 4): airline, both times with their
 * airport codes, duration, stops and the per-person price.
 *
 * Books when it can. `bookingUrl` is the link to this exact fare, and it is
 * null for sample data — a card without one renders as it always did, because
 * an invented price must not carry a button to a real checkout.
 */
export function FlightResultCard({
  flight,
  as = 'div',
  onAddToTrip,
  isOnTrip = false,
  className,
}: FlightResultCardProps) {
  const {
    airline,
    from,
    to,
    departureTime,
    arrivalTime,
    duration,
    stops,
    price,
    bookingUrl,
    departureDate,
    returnLeg,
  } = flight;

  return (
    <Card as={as} padding="lg" elevation="soft" className={cx(styles.card, className)}>
      <div className={styles.top}>
        <span className={styles.logo} aria-hidden="true">
          {airlineInitials(airline)}
        </span>
        <span className={styles.airline}>{airline}</span>
        <span className={styles.stops}>
          {formatStops(stops)}
          {/*
            Named only when there is a second leg to tell it apart from. On a
            one-way fare "Direct" needs no qualifier.
          */}
          {returnLeg ? <span className={styles.tripType}> · Round trip</span> : null}
        </span>
      </div>

      {/*
        Both flights, when the price buys both. A round-trip fare quoted as one
        set of times read as a one-way at twice the price — the way home is
        half of what is being sold, so it is shown.
      */}
      <RouteLeg
        label={returnLeg ? 'Outbound' : undefined}
        departureTime={departureTime}
        arrivalTime={arrivalTime}
        from={from}
        to={to}
        date={departureDate}
        duration={duration}
      />

      {returnLeg ? (
        <RouteLeg
          label="Return"
          departureTime={returnLeg.departureTime}
          arrivalTime={returnLeg.arrivalTime}
          // Reversed, because this is the way back — the leg carries no route
          // of its own precisely so the two cannot disagree.
          from={to}
          to={from}
          date={returnLeg.date}
          duration={returnLeg.duration}
        />
      ) : null}

      <div className={styles.priceRow}>
        <p className={styles.priceGroup}>
          <span className={styles.price}>{formatCurrency(price)}</span>
          <span className={styles.perPerson}>per person</span>
        </p>

        {onAddToTrip ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={isOnTrip}
            leadingIcon={isOnTrip ? undefined : <PlusIcon size={16} />}
            onClick={onAddToTrip}
          >
            {isOnTrip ? 'On this trip' : 'Add to trip'}
          </Button>
        ) : null}

        {bookingUrl ? (
          <Button
            variant="primary"
            size="md"
            className={styles.book}
            href={bookingUrl}
            trailingIcon={<ExternalLinkIcon size={16} />}
            /*
             * `sponsored` is the correct value for a paid affiliate link, and
             * overrides `Button`'s default — the photo-credit links that share
             * that default are not sponsored, so it stays as it is.
             */
            rel="sponsored noopener"
            aria-label={`Book ${airline} from ${from} to ${to} for ${formatCurrency(price)} per person, on our partner's site`}
          >
            Book
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * One leg of a fare: times at each end, the airports, and the time between.
 *
 * Shared by the outbound and the return so the two cannot drift apart — the
 * return used to have no rendering at all, and giving it a second copy of this
 * markup is how it would end up looking like a different kind of thing.
 */
function RouteLeg({
  label,
  departureTime,
  arrivalTime,
  from,
  to,
  date,
  duration,
}: {
  /** Omitted on a one-way fare, where there is nothing to distinguish. */
  label?: string;
  departureTime: string;
  arrivalTime: string;
  from: string;
  to: string;
  date: string | null;
  duration: string;
}) {
  return (
    <div className={styles.route}>
      {label ? <span className={styles.legLabel}>{label}</span> : null}

      <div className={styles.endpoint}>
        <span className={styles.time}>{departureTime}</span>
        <span className={styles.airport}>
          {from}
          {/*
            The leg's own day, when it has one. Live fares come back from a
            month-wide search, so this is frequently not the day the header
            says — and a price under the wrong date is worse than no price.
          */}
          {date ? <span className={styles.date}> · {formatShortDate(date)}</span> : null}
        </span>
      </div>

      <div className={styles.leg}>
        <span className={styles.duration}>{duration}</span>
        <span className={styles.line} aria-hidden="true" />
      </div>

      <div className={cx(styles.endpoint, styles.arrival)}>
        <span className={styles.time}>{arrivalTime}</span>
        <span className={styles.airport}>{to}</span>
      </div>
    </div>
  );
}
