import type { Partner, PartnerCategory } from '../../core/types/travel.types';

/** DESIGN_SPEC Screen 7 tabs. */
export const BOOKING_TABS = [
  { id: 'flights', label: 'Flights' },
  { id: 'hotels', label: 'Hotels' },
  { id: 'activities', label: 'Activities' },
] as const satisfies readonly { id: PartnerCategory; label: string }[];

export const DEFAULT_BOOKING_TAB: PartnerCategory = 'flights';

export function isBookingTab(value: string | null): value is PartnerCategory {
  return BOOKING_TABS.some((tab) => tab.id === value);
}

/** Partners can appear under more than one tab. */
export function filterPartnersByCategory(
  partners: Partner[],
  category: PartnerCategory,
): Partner[] {
  return partners.filter((partner) => partner.categories.includes(category));
}
