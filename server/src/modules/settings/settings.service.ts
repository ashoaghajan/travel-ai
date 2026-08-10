import { BASE_CURRENCY } from '@ai-travel/shared';
import type { ApiSettings } from '@ai-travel/shared';
import type { UpdateSettingsBody } from '@ai-travel/shared/schemas';
import type { UserSettings } from '@prisma/client';
import { prisma } from '../../prisma';

/**
 * App preferences.
 *
 * Every account has settings whether or not a row exists for it: the defaults
 * below are the answer until someone changes something, and a row is written
 * on the first write rather than at registration. That keeps sign-up one
 * insert, and it means an account that never opens the settings screen costs
 * no storage.
 */

export const DEFAULT_SETTINGS: ApiSettings = {
  theme: 'system',
  // The currency prices are already quoted in, so the default costs no
  // conversion and no rate lookup.
  currency: BASE_CURRENCY,
  notifications: {
    tripReminders: true,
    priceAlerts: false,
  },
};

/**
 * Row to wire shape.
 *
 * `theme` is a plain column, so it is narrowed here rather than trusted. A
 * value outside the union could only come from a hand-edited database, and the
 * client's `resolveTheme` would treat it as light anyway — this makes that
 * explicit instead of leaking an unknown string into a typed field.
 */
export function toApiSettings(row: UserSettings | null): ApiSettings {
  if (!row) return DEFAULT_SETTINGS;

  const theme: ApiSettings['theme'] =
    row.theme === 'dark' || row.theme === 'light' || row.theme === 'system'
      ? row.theme
      : DEFAULT_SETTINGS.theme;

  return {
    theme,
    currency: row.currency,
    notifications: {
      tripReminders: row.tripReminders,
      priceAlerts: row.priceAlerts,
    },
  };
}

export async function getSettings(userId: string): Promise<ApiSettings> {
  return toApiSettings(await prisma.userSettings.findUnique({ where: { userId } }));
}

/**
 * Applies a partial update and returns the whole record.
 *
 * The whole record, not the patch: the settings screen renders every toggle,
 * and answering with only what changed would make the client merge — which is
 * how a screen ends up showing a preference the database does not hold.
 *
 * `notifications` merges field by field rather than wholesale. The screen
 * writes one switch at a time, and replacing the object would reset the other
 * switch to its default every time either was touched.
 */
export async function updateSettings(
  userId: string,
  patch: UpdateSettingsBody,
): Promise<ApiSettings> {
  const current = await getSettings(userId);

  const next: ApiSettings = {
    theme: patch.theme ?? current.theme,
    currency: patch.currency ?? current.currency,
    notifications: {
      tripReminders: patch.notifications?.tripReminders ?? current.notifications.tripReminders,
      priceAlerts: patch.notifications?.priceAlerts ?? current.notifications.priceAlerts,
    },
  };

  const row = await prisma.userSettings.upsert({
    where: { userId },
    // Upsert rather than update: the row is written on first change, so the
    // first thing anyone ever toggles would otherwise fail on a missing row.
    create: {
      userId,
      theme: next.theme,
      currency: next.currency,
      tripReminders: next.notifications.tripReminders,
      priceAlerts: next.notifications.priceAlerts,
    },
    update: {
      theme: next.theme,
      currency: next.currency,
      tripReminders: next.notifications.tripReminders,
      priceAlerts: next.notifications.priceAlerts,
    },
  });

  return toApiSettings(row);
}
