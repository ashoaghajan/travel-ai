/** Device-local preferences, persisted under `ai-travel-planner:settings`. */

import type { CurrencyCode } from '@ai-travel/shared';

export type ThemePreference = 'system' | 'light' | 'dark';

export type NotificationSettings = {
  tripReminders: boolean;
  priceAlerts: boolean;
};

export type AppSettings = {
  theme: ThemePreference;
  /**
   * The currency prices are shown in.
   *
   * A display preference only. Prices are quoted and stored in USD; this
   * changes how they are rendered and nothing about what they are.
   */
  currency: CurrencyCode;
  notifications: NotificationSettings;
};
