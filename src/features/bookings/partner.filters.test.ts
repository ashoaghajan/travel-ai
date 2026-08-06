import { describe, expect, it } from 'vitest';
import type { Partner } from '../../types/travel.types';
import { MOCK_PARTNERS } from '../../mock/partners';
import { BOOKING_TABS, DEFAULT_BOOKING_TAB, filterPartnersByCategory, isBookingTab } from './partner.filters';

const names = (partners: Partner[]) => partners.map((partner) => partner.name);

describe('BOOKING_TABS', () => {
  it('matches the tabs DESIGN_SPEC lists, in order', () => {
    expect(BOOKING_TABS.map((tab) => tab.label)).toEqual(['Flights', 'Hotels', 'Activities']);
  });

  it('opens on Flights', () => {
    expect(DEFAULT_BOOKING_TAB).toBe('flights');
  });
});

describe('filterPartnersByCategory', () => {
  it('lists the flight partners', () => {
    expect(names(filterPartnersByCategory(MOCK_PARTNERS, 'flights'))).toEqual([
      'Expedia',
      'Trip.com',
    ]);
  });

  it('lists the hotel partners', () => {
    expect(names(filterPartnersByCategory(MOCK_PARTNERS, 'hotels'))).toEqual([
      'Expedia',
      'Booking.com',
      'Trip.com',
    ]);
  });

  it('lists the activity partners', () => {
    expect(names(filterPartnersByCategory(MOCK_PARTNERS, 'activities'))).toEqual([
      'GetYourGuide',
    ]);
  });

  it('shows a partner under every category it covers', () => {
    const expedia = MOCK_PARTNERS.find((partner) => partner.name === 'Expedia');

    expect(expedia?.categories).toEqual(['flights', 'hotels']);
    expect(names(filterPartnersByCategory(MOCK_PARTNERS, 'flights'))).toContain('Expedia');
    expect(names(filterPartnersByCategory(MOCK_PARTNERS, 'hotels'))).toContain('Expedia');
  });

  it('preserves the source order', () => {
    const hotels = filterPartnersByCategory(MOCK_PARTNERS, 'hotels');
    const expected = MOCK_PARTNERS.filter((partner) => partner.categories.includes('hotels'));

    expect(names(hotels)).toEqual(names(expected));
  });

  it('never leaves a tab empty', () => {
    for (const tab of BOOKING_TABS) {
      expect(filterPartnersByCategory(MOCK_PARTNERS, tab.id).length).toBeGreaterThan(0);
    }
  });

  it('handles an empty list', () => {
    expect(filterPartnersByCategory([], 'flights')).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [...MOCK_PARTNERS];
    filterPartnersByCategory(input, 'hotels');

    expect(names(input)).toEqual(names(MOCK_PARTNERS));
  });
});

describe('isBookingTab', () => {
  it('accepts every tab id', () => {
    for (const tab of BOOKING_TABS) {
      expect(isBookingTab(tab.id)).toBe(true);
    }
  });

  it.each([['cruises'], [''], [null], ['Flights']])('rejects %s as a URL value', (value) => {
    expect(isBookingTab(value)).toBe(false);
  });
});
