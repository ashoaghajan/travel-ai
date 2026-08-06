import type { Activity } from '../../types/travel.types';
import type { ActivityCategory } from '../../types/trip.types';

/**
 * Category filtering for the explorer — pure, so the rule is one line to read
 * and can be tested without rendering anything.
 */

export const ALL_ACTIVITIES = 'all';

/** Either a real category or the "All" pseudo-category. */
export type ActivityFilterId = typeof ALL_ACTIVITIES | ActivityCategory;

/** Chips from DESIGN_SPEC Screen 6, in order. */
export const ACTIVITY_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'nature', label: 'Nature' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'culture', label: 'Culture' },
  { id: 'food', label: 'Food' },
] as const satisfies readonly { id: ActivityFilterId; label: string }[];

export function isActivityFilter(value: string | null): value is ActivityFilterId {
  return ACTIVITY_CHIPS.some((chip) => chip.id === value);
}

/** "All" passes everything through; any other chip matches on category. */
export function filterActivitiesByCategory(
  activities: Activity[],
  filter: ActivityFilterId,
): Activity[] {
  if (filter === ALL_ACTIVITIES) return activities;
  return activities.filter((activity) => activity.category === filter);
}

/** Case- and accent-folded, so "Familia" finds "Sagrada Família". */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Free-text match over an attraction's title and description.
 *
 * OpenTripMap has no keyword endpoint — `activity.service` answers with the
 * pool for a city and nothing narrower — so finding a place means filtering
 * what is already in hand. Every term has to appear somewhere, in any order,
 * which is what makes "temple ubud" find the same thing as "ubud temple".
 *
 * The description carries the taxonomy ("Hindu temples · 4.2 km from centre"),
 * so searching by what a place *is* works as well as searching by its name.
 */
export function filterActivitiesByText(activities: Activity[], query: string): Activity[] {
  const terms = fold(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);

  if (terms.length === 0) return activities;

  return activities.filter((activity) => {
    const haystack = fold(`${activity.title} ${activity.description}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/** Display label for a category, used on the card badge. */
export function categoryLabel(category: ActivityCategory): string {
  const chip = ACTIVITY_CHIPS.find((candidate) => candidate.id === category);
  return chip?.label ?? category.charAt(0).toUpperCase() + category.slice(1);
}
