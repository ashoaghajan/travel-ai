import { CheckIcon } from '../../../components/common/icons';
import type { BookingContext } from '../../../types/travel.types';
import { cx } from '../../../utils/cx';
import { formatShortDate } from '../../../utils/date';
import { hasReturnLeg, legRoute } from '../flight.legs';
import type { FlightLeg, FlightLegRoute } from '../flight.legs';
import styles from './FlightLegs.module.css';

export type FlightLegsProps = {
  context: BookingContext;
  /** The step on screen. */
  value: FlightLeg;
  onChange: (next: FlightLeg) => void;
  /** Legs whose fare has been taken — booked, or added to the trip. */
  chosen?: readonly FlightLeg[];
  className?: string;
};

const LEGS: { id: FlightLeg; label: string }[] = [
  { id: 'outbound', label: 'Outbound' },
  { id: 'return', label: 'Return' },
];

/** "AUH → EVN · Sep 14", or as much of it as the search knows. */
function describeRoute(route: FlightLegRoute): string {
  const ends = route.from && route.to ? `${route.from} → ${route.to}` : '';
  const date = route.date ? formatShortDate(route.date) : '';

  return [ends, date].filter(Boolean).join(' · ');
}

/**
 * How one step reads aloud.
 *
 * "Chosen" is said in words as well as shown by the tick, which is decorative:
 * a step's state has to survive being read rather than looked at.
 */
function describeStep(label: string, route: FlightLegRoute, isChosen: boolean): string {
  const described = describeRoute(route);

  return [label, described && `: ${described}`, isChosen && ' — chosen'].filter(Boolean).join('');
}

/**
 * The two steps a round trip is booked in: the way out, then the way home.
 *
 * Steps rather than a toggle, because these are ordered and one of them gets
 * done first. Both stay clickable all the same — a reader who wants to price
 * the way home before committing to the way out is doing something reasonable,
 * and a stepper that refuses to go backwards would strand anyone who books the
 * outbound on a partner site and comes back to change it.
 */
export function FlightLegs({ context, value, onChange, chosen = [], className }: FlightLegsProps) {
  const outboundRoute = legRoute(context, 'outbound');

  /*
   * One way: no steps, just the line saying what is being priced. The stepper
   * would be a list of one with a number in front of it.
   */
  if (!hasReturnLeg(context)) {
    const described = describeRoute(outboundRoute);

    return described ? <p className={cx(styles.single, className)}>{described}</p> : null;
  }

  return (
    <ol className={cx(styles.steps, className)} aria-label="Book this trip in two steps">
      {LEGS.map((leg, index) => {
        const route = legRoute(context, leg.id);
        const isCurrent = value === leg.id;
        const isChosen = chosen.includes(leg.id);

        return (
          <li key={leg.id} className={styles.step}>
            <button
              type="button"
              className={styles.trigger}
              /*
               * `aria-current="step"`, not `aria-pressed`. These are positions
               * in a sequence rather than two switches, and a screen reader
               * announcing "pressed" would describe the wrong kind of control.
               */
              aria-current={isCurrent ? 'step' : undefined}
              /*
               * Spelled out rather than left to the contents. The label and
               * the route are separate elements for the two-line layout, and
               * the computed name runs them together — "ReturnEVN → AUH".
               */
              aria-label={describeStep(leg.label, route, isChosen)}
              onClick={() => onChange(leg.id)}
            >
              <span
                className={cx(styles.marker, isChosen && styles.markerDone)}
                aria-hidden="true"
              >
                {isChosen ? <CheckIcon size={14} /> : index + 1}
              </span>

              <span className={styles.body}>
                <span className={styles.label}>{leg.label}</span>
                <span className={styles.route}>{describeRoute(route)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
