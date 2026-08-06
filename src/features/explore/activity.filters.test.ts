import { describe, expect, it } from 'vitest';
import type { Activity } from '../../types/travel.types';
import type { ActivityCategory } from '../../types/trip.types';
import {
  ACTIVITY_CHIPS,
  ALL_ACTIVITIES,
  categoryLabel,
  filterActivitiesByCategory,
  filterActivitiesByText,
  isActivityFilter,
} from './activity.filters';

/** Fixtures, not app data: these tests describe the filter, not the catalogue. */
function activity(title: string, category: ActivityCategory): Activity {
  return {
    id: `activity-${title}`,
    title,
    category,
    description: 'A thing to do',
    price: 0,
    rating: 0,
    reviews: 0,
    image: '/photo.jpg',
  };
}

const ACTIVITIES: Activity[] = [
  activity('Nusa Penida Day Trip', 'adventure'),
  activity('Ubud Rice Terrace Tour', 'nature'),
  activity('Uluwatu Sunset & Kecak Dance', 'culture'),
  activity('Bali Food Tour', 'food'),
];

const titles = (activities: Activity[]) => activities.map((a) => a.title);

describe('ACTIVITY_CHIPS', () => {
  it('matches the categories DESIGN_SPEC lists, in order', () => {
    expect(ACTIVITY_CHIPS.map((chip) => chip.label)).toEqual([
      'All',
      'Nature',
      'Adventure',
      'Culture',
      'Food',
    ]);
  });

  it('leads with the "all" pseudo-category', () => {
    expect(ACTIVITY_CHIPS[0].id).toBe(ALL_ACTIVITIES);
  });
});

describe('filterActivitiesByCategory', () => {
  it('returns everything for "all"', () => {
    expect(filterActivitiesByCategory(ACTIVITIES, 'all')).toHaveLength(
      ACTIVITIES.length,
    );
  });

  it.each([
    ['nature', 'Ubud Rice Terrace Tour'],
    ['adventure', 'Nusa Penida Day Trip'],
    ['culture', 'Uluwatu Sunset & Kecak Dance'],
    ['food', 'Bali Food Tour'],
  ] as const)('filters to %s', (category, expected) => {
    expect(titles(filterActivitiesByCategory(ACTIVITIES, category))).toEqual([expected]);
  });

  it('leaves every chip with something to show', () => {
    for (const chip of ACTIVITY_CHIPS) {
      expect(filterActivitiesByCategory(ACTIVITIES, chip.id).length).toBeGreaterThan(0);
    }
  });

  it('returns nothing for a category with no activities', () => {
    expect(filterActivitiesByCategory(ACTIVITIES, 'relaxation')).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(filterActivitiesByCategory([], 'food')).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [...ACTIVITIES];
    filterActivitiesByCategory(input, 'food');

    expect(titles(input)).toEqual(titles(ACTIVITIES));
  });
});

describe('isActivityFilter', () => {
  it('accepts every chip id', () => {
    for (const chip of ACTIVITY_CHIPS) {
      expect(isActivityFilter(chip.id)).toBe(true);
    }
  });

  it.each([['sailing'], [''], [null], ['relaxation'], ['Food']])(
    'rejects %s as a URL value',
    (value) => {
      expect(isActivityFilter(value)).toBe(false);
    },
  );
});

describe('categoryLabel', () => {
  it('uses the chip label for chip categories', () => {
    expect(categoryLabel('nature')).toBe('Nature');
    expect(categoryLabel('food')).toBe('Food');
  });

  it('capitalises categories that have no chip', () => {
    expect(categoryLabel('relaxation')).toBe('Relaxation');
    expect(categoryLabel('travel')).toBe('Travel');
  });
});

describe('filterActivitiesByText', () => {
  /** The text filter reads title *and* description, so both are set here. */
  function place(title: string, description: string): Activity {
    return { ...activity(title, 'culture'), id: `place-${title}`, description };
  }

  const places = [
    place('Cascade Complex', 'Monuments · 0.8 km from centre'),
    place('Sagrada Família', 'Cathedrals · 1.2 km from centre'),
    place('Ubud Water Temple', 'Hindu temples · 4.2 km from centre'),
  ];

  it('passes everything through for an empty query', () => {
    expect(filterActivitiesByText(places, '')).toEqual(places);
  });

  it('passes everything through for a whitespace query', () => {
    expect(filterActivitiesByText(places, '   ')).toEqual(places);
  });

  it('ignores case', () => {
    expect(filterActivitiesByText(places, 'CASCADE')).toEqual([places[0]]);
  });

  it('ignores accents, so "familia" finds "Família"', () => {
    expect(filterActivitiesByText(places, 'familia')).toEqual([places[1]]);
  });

  it('matches on the description, not just the title', () => {
    expect(filterActivitiesByText(places, 'cathedral')).toEqual([places[1]]);
  });

  it('requires every term, in any order', () => {
    expect(filterActivitiesByText(places, 'temple ubud')).toEqual([places[2]]);
    expect(filterActivitiesByText(places, 'ubud temple')).toEqual([places[2]]);
  });

  it('returns nothing when a term matches nothing', () => {
    expect(filterActivitiesByText(places, 'cascade cathedral')).toEqual([]);
  });
});
