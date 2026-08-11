import type { BookingContext } from '../../types/travel.types';

/**
 * Which half of the journey the reader is choosing.
 *
 * Two one-way fares rather than one round trip, deliberately. A round-trip
 * quote is a single number covering both flights, and the app used to halve it
 * to fill two booking rows — but the halves are a fiction: the same AUH↔EVN
 * journey that bundles at $363 is $177 out and $220 back. Searching each leg
 * separately is the only way the two rows can carry what either flight
 * actually costs, and it lets the reader take a different airline, or a
 * different day, for the way home.
 *
 * The cost of the honesty is real and worth knowing: booked apart, those two
 * fares come to $397 rather than $363.
 *
 * Pure — no React. The stepper renders these, `BookingBrowser` searches on
 * them, and neither owns them.
 */
export type FlightLeg = 'outbound' | 'return';

/** Where one leg flies, and when. Derived, never chosen. */
export type FlightLegRoute = {
  from: string;
  to: string;
  date: string;
};

/**
 * A leg's route, read off the search above it.
 *
 * This used to be state, with its own From/To pair under the leg toggle —
 * which asked the reader for the route twice on a screen whose search form had
 * just taken it, and let the two disagree. There is only one answer: the
 * return of an AUH→EVN trip is EVN→AUH on the day it ends, and it follows from
 * the search rather than being a second opinion about it.
 */
export function legRoute(context: BookingContext, leg: FlightLeg): FlightLegRoute {
  const outbound = leg === 'outbound';

  return {
    from: (outbound ? context.originCode : context.destinationCode) ?? '',
    to: (outbound ? context.destinationCode : context.originCode) ?? '',
    // Out on the day the trip starts, back on the day it ends.
    date: (outbound ? context.departDate : context.returnDate) ?? '',
  };
}

/**
 * Whether there is a way home to choose at all.
 *
 * A one-way search has one leg, so it gets no stepper — two steps where the
 * second can never apply is worse than none.
 */
export function hasReturnLeg(context: BookingContext): boolean {
  return context.tripType === 'round-trip' && Boolean(context.returnDate);
}
