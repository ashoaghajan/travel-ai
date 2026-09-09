import { z } from 'zod';
import { CURRENCY_CODES } from '../currency.types';

/** The six activity categories, as the planner and the explorer both name them. */
const ACTIVITY_CATEGORIES = [
  'food',
  'nature',
  'culture',
  'adventure',
  'relaxation',
  'travel',
] as const;

/**
 * `HH:MM`, 24-hour.
 *
 * A string rather than minutes, matching the column and `ItineraryActivity.time`.
 * The regex is the validation the type cannot do: '25:00' and '9:5' are both
 * strings, and both would schedule a day nobody could read.
 */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time like 09:30');

/**
 * What the server will accept as app preferences.
 *
 * Server-only, behind the `@ai-travel/shared/schemas` export path so zod never
 * reaches the browser bundle.
 */

/**
 * A partial update, because the settings screen writes one toggle at a time.
 *
 * Absent means "leave it". There is no `null` here, unlike `TripPatch` —
 * nothing in this record is clearable, only settable, and every field has a
 * default that applies when nobody has chosen.
 */
export const updateSettingsSchema = z.object({
  /*
   * The appearances. Deliberately *not* accepting the retired
   * 'system' | 'light' | 'dark': a client still sending those is out of date,
   * and a 422 says so where a silent coercion would leave it believing a
   * choice was saved. Reading an old row is the other direction and does
   * coerce — see `settings.service.ts`.
   */
  theme: z.enum(['sharpen', 'atlas', 'console']).optional(),
  /**
   * Checked against the offered list rather than accepted as any ISO code.
   *
   * A currency the app cannot convert would be stored happily and then fall
   * back to dollars on every screen, under a label claiming otherwise.
   */
  currency: z.enum(CURRENCY_CODES as unknown as [string, ...string[]]).optional(),
  notifications: z
    .object({
      tripReminders: z.boolean().optional(),
      priceAlerts: z.boolean().optional(),
    })
    .optional(),
  /**
   * How the planner should build a day.
   *
   * `null` *is* accepted on the two budgets, and only there — they are the one
   * pair of fields where "no ceiling" is a value somebody chooses rather than
   * the absence of one, and it has to be reachable after a limit has been set.
   * The rest follow the rule above: absent means leave it.
   */
  travel: z
    .object({
      dayStart: timeOfDay.optional(),
      dayEnd: timeOfDay.optional(),
      pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
      /*
       * Bounded to the categories that exist and to 0..1. An unknown key is
       * rejected rather than stored: the planner looks weights up by category,
       * so a misspelled one would be written, returned, shown as saved, and
       * silently never consulted.
       */
      categoryWeights: z
        // `partialRecord`, not `record`: a record keyed by an enum is
        // exhaustive in zod 4, and this patch carries the one slider that
        // moved.
        .partialRecord(z.enum(ACTIVITY_CATEGORIES), z.number().min(0).max(1))
        .optional(),
      // Whole dollars, and capped: this is a limit somebody types, and a typo
      // with an extra zero should not become a budget of a hundred thousand.
      maxActivityPrice: z.number().int().min(0).max(100_000).nullable().optional(),
      dailyActivityBudget: z.number().int().min(0).max(100_000).nullable().optional(),
      meals: z
        .object({ lunch: z.boolean().optional(), dinner: z.boolean().optional() })
        .optional(),
      /*
       * Whole kilometres, and clearable for the same reason the budgets are:
       * "no limit" is a state somebody chooses after setting one.
       *
       * Floored at 1 rather than 0. A zero-kilometre radius admits nothing but
       * the hotel itself, so it is not a narrower preference than one — it is
       * an empty trip, and no control offers it.
       */
      maxDistanceFromHotelKm: z.number().int().min(1).max(100).nullable().optional(),
      nearMetroOnly: z.boolean().optional(),
    })
    .optional(),
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;
