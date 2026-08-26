import { z } from 'zod';
import { CURRENCY_CODES } from '../currency.types';

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
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;
