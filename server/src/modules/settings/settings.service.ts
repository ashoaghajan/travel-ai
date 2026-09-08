import { BASE_CURRENCY } from '@ai-travel/shared';
import type { ApiSettings, ApiTravelPreferences } from '@ai-travel/shared';
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

/**
 * A tourist's day, as the planner assumes it when nobody has said.
 *
 * These must agree with `DEFAULT_PREFERENCES` in the client's
 * `itinerary.planner.ts`. Two copies, because the scheduler runs in the
 * browser and on the phone and must plan before any account has loaded — but
 * only one of them is ever *stored*, and it is this one.
 *
 * The weights are level rather than zero. An untouched preference must not
 * read as "no thank you", which is exactly what a zero means here.
 */
export const DEFAULT_TRAVEL_PREFERENCES: ApiTravelPreferences = {
  dayStart: '09:30',
  dayEnd: '18:00',
  pace: 'balanced',
  categoryWeights: {
    food: 0.5,
    nature: 0.5,
    culture: 0.5,
    adventure: 0.5,
    relaxation: 0.5,
    travel: 0,
  },
  maxActivityPrice: null,
  dailyActivityBudget: null,
  meals: { lunch: true, dinner: true },
};

export const DEFAULT_SETTINGS: ApiSettings = {
  theme: 'sharpen',
  // The currency prices are already quoted in, so the default costs no
  // conversion and no rate lookup.
  currency: BASE_CURRENCY,
  notifications: {
    tripReminders: true,
    priceAlerts: false,
  },
  travel: DEFAULT_TRAVEL_PREFERENCES,
};

/**
 * The stored weights, or the defaults for the categories a row does not name.
 *
 * A `Json` column can hold anything, including what an older or hand-edited
 * row left there, so every value is checked rather than cast. A key that is
 * not a number in 0..1 falls back to its default — the alternative is a
 * `NaN` weight, which sorts every place it touches to the bottom of the pool
 * and looks exactly like a preference nobody set.
 */
function toCategoryWeights(stored: unknown): ApiTravelPreferences['categoryWeights'] {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return DEFAULT_TRAVEL_PREFERENCES.categoryWeights;
  }

  const weights = { ...DEFAULT_TRAVEL_PREFERENCES.categoryWeights };

  for (const [category, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!(category in weights)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) continue;

    weights[category] = value;
  }

  return weights;
}

function toPace(stored: string): ApiTravelPreferences['pace'] {
  return stored === 'relaxed' || stored === 'balanced' || stored === 'packed'
    ? stored
    : DEFAULT_TRAVEL_PREFERENCES.pace;
}

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
    row.theme === 'sharpen' || row.theme === 'atlas' || row.theme === 'console'
      ? row.theme
      : /*
         * Covers both the genuinely corrupt and the merely old. Rows written
         * before the appearances existed hold 'system' | 'light' | 'dark', and
         * every one of them was being shown what is now called Sharpen — so
         * falling back is a rename, not a loss of the reader's choice.
         */
        DEFAULT_SETTINGS.theme;

  return {
    theme,
    currency: row.currency,
    notifications: {
      tripReminders: row.tripReminders,
      priceAlerts: row.priceAlerts,
    },
    travel: {
      dayStart: row.dayStart,
      dayEnd: row.dayEnd,
      pace: toPace(row.pace),
      categoryWeights: toCategoryWeights(row.categoryWeights),
      maxActivityPrice: row.maxActivityPrice,
      dailyActivityBudget: row.dailyActivityBudget,
      meals: { lunch: row.lunch, dinner: row.dinner },
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
    travel: {
      dayStart: patch.travel?.dayStart ?? current.travel.dayStart,
      dayEnd: patch.travel?.dayEnd ?? current.travel.dayEnd,
      pace: patch.travel?.pace ?? current.travel.pace,
      // Merged per category, for the reason the notifications are: the screen
      // moves one slider at a time, and replacing the map would reset the
      // other five every time any one of them was touched.
      categoryWeights: { ...current.travel.categoryWeights, ...patch.travel?.categoryWeights },
      /*
       * `??` would be wrong on these two, and this is the one place in this
       * file where that matters: null is a value here — "no ceiling" — not an
       * absence, so `null ?? current` would make a limit impossible to remove
       * once set. Absent is the only thing that means "leave it".
       */
      maxActivityPrice:
        patch.travel && 'maxActivityPrice' in patch.travel
          ? (patch.travel.maxActivityPrice ?? null)
          : current.travel.maxActivityPrice,
      dailyActivityBudget:
        patch.travel && 'dailyActivityBudget' in patch.travel
          ? (patch.travel.dailyActivityBudget ?? null)
          : current.travel.dailyActivityBudget,
      meals: {
        lunch: patch.travel?.meals?.lunch ?? current.travel.meals.lunch,
        dinner: patch.travel?.meals?.dinner ?? current.travel.meals.dinner,
      },
    },
  };

  const columns = {
    theme: next.theme,
    currency: next.currency,
    tripReminders: next.notifications.tripReminders,
    priceAlerts: next.notifications.priceAlerts,
    dayStart: next.travel.dayStart,
    dayEnd: next.travel.dayEnd,
    pace: next.travel.pace,
    categoryWeights: next.travel.categoryWeights,
    maxActivityPrice: next.travel.maxActivityPrice,
    dailyActivityBudget: next.travel.dailyActivityBudget,
    lunch: next.travel.meals.lunch,
    dinner: next.travel.meals.dinner,
  };

  const row = await prisma.userSettings.upsert({
    where: { userId },
    // Upsert rather than update: the row is written on first change, so the
    // first thing anyone ever toggles would otherwise fail on a missing row.
    create: { userId, ...columns },
    update: columns,
  });

  return toApiSettings(row);
}
