import { describe, expect, it } from 'vitest';
import type { BookingContext } from '../../types/travel.types';
import { hasReturnLeg, legRoute } from './flight.legs';

/**
 * The route a leg flies is derived, and this is where that is asserted.
 *
 * It used to be state the reader typed a second time, under the leg toggle, on
 * a screen whose search form had already asked for it. The bug that made this
 * a rule: the two could disagree, and the fares then belonged to a journey the
 * form above them did not describe.
 */

const AUH_EVN: BookingContext = {
  tripType: 'round-trip',
  originCode: 'AUH',
  destinationCode: 'EVN',
  destinationCity: 'Yerevan',
  destinationCountry: 'Armenia',
  departDate: '2026-09-14',
  returnDate: '2026-09-19',
  travellers: 2,
};

describe('legRoute', () => {
  it('flies the outbound the way the search reads', () => {
    expect(legRoute(AUH_EVN, 'outbound')).toEqual({
      from: 'AUH',
      to: 'EVN',
      date: '2026-09-14',
    });
  });

  it('turns the return around, on the day the trip ends', () => {
    // The whole point of dropping the second selector: nobody has to say that
    // the way home from Yerevan is to Abu Dhabi.
    expect(legRoute(AUH_EVN, 'return')).toEqual({
      from: 'EVN',
      to: 'AUH',
      date: '2026-09-19',
    });
  });

  it('carries an unknown end through as empty rather than inventing one', () => {
    const half: BookingContext = { ...AUH_EVN, destinationCode: null };

    expect(legRoute(half, 'outbound').to).toBe('');
    expect(legRoute(half, 'return').from).toBe('');
  });
});

describe('hasReturnLeg', () => {
  it('is true for a round trip with a date to come back on', () => {
    expect(hasReturnLeg(AUH_EVN)).toBe(true);
  });

  it('is false one way', () => {
    expect(hasReturnLeg({ ...AUH_EVN, tripType: 'one-way' })).toBe(false);
  });

  it('is false for a round trip with no return date', () => {
    // A round trip missing the date is not a second leg anyone can be shown
    // fares for — a step that can never apply is worse than no step.
    expect(hasReturnLeg({ ...AUH_EVN, returnDate: null })).toBe(false);
  });
});
