/** Device-local preferences, persisted under `ai-travel-planner:settings`. */

import type { CurrencyCode } from '@ai-travel/shared';
import type { TravelPreferences } from './planner.types';

/**
 * Which of the three looks the app wears.
 *
 * This replaced a `'system' | 'light' | 'dark'` preference. Light and dark did
 * not go away — every appearance ships both grounds — they stopped being a
 * *choice*. The reader picks the character of the interface; the operating
 * system still decides whether it is light or dark, the way it decides for
 * every other app on the device.
 *
 * - `sharpen`  the original look, with its contrast defects corrected.
 * - `atlas`    photography-led: no card borders or shadows, larger media, a
 *              serif display face and a true 1.25 type scale.
 * - `console`  density-led: tighter spacing, small radii, hairline borders in
 *              place of shadows, and tabular figures so prices compare.
 *
 * `APPEARANCES` below is the source of truth for the set — the pickers on both
 * platforms and the stored-value migration all read it, so adding a fourth
 * look means touching one array and two token blocks.
 */
export type Appearance = 'sharpen' | 'atlas' | 'console';

export const APPEARANCES = [
  {
    id: 'sharpen' as const,
    label: 'Sharpen',
    description: 'The familiar look, with sharper contrast.',
  },
  {
    id: 'atlas' as const,
    label: 'Atlas',
    description: 'Photographs first, chrome out of the way.',
  },
  {
    id: 'console' as const,
    label: 'Console',
    description: 'Compact rows, built for comparing.',
  },
];

/** The look a record falls back to — the one that matches the app as it was. */
export const DEFAULT_APPEARANCE: Appearance = 'sharpen';

/**
 * Whether a stored or wire value is still a look we ship.
 *
 * Needed in more places than a type guard usually is: the column is a plain
 * string, `settingsService` merges stored values over defaults without
 * validating them, and records written before this existed hold `'system'`,
 * `'light'` or `'dark'`. All three of those answer `false` here and fall back
 * to `sharpen`, which is what they looked like anyway.
 */
export function isAppearance(value: unknown): value is Appearance {
  return APPEARANCES.some((appearance) => appearance.id === value);
}

export type NotificationSettings = {
  tripReminders: boolean;
  priceAlerts: boolean;
};

export type AppSettings = {
  /**
   * The chosen appearance.
   *
   * Still called `theme` because that is the column, the wire field and the
   * storage key; renaming it would be a database migration for a word. What
   * changed is the set of values it can hold — see `Appearance`.
   */
  theme: Appearance;
  /**
   * The currency prices are shown in.
   *
   * A display preference only. Prices are quoted and stored in USD; this
   * changes how they are rendered and nothing about what they are.
   */
  currency: CurrencyCode;
  notifications: NotificationSettings;
  /**
   * How this reader wants their days planned.
   *
   * Read by `itinerary.planner.ts` on every generated trip. It lives with the
   * other preferences rather than in the planner's own state because it is a
   * standing answer, not a per-prompt one — somebody who never starts before
   * eleven never starts before eleven, and being asked again on every trip
   * would be the same question with the same answer.
   */
  travel: TravelPreferences;
};
