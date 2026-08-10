import { BASE_CURRENCY, isCurrencyCode } from '@ai-travel/shared';
import type { AppSettings } from '../types/settings.types';
import type { StorageEntryUsage } from './localStorage.service';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * App preferences.
 *
 * Synchronous on purpose: these are device-local settings, so there is no
 * network round trip to model. If Stage 2 ever syncs preferences to an
 * account, this file gains the async variants and nothing else changes.
 */

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  // The currency every price is already quoted in, so the default costs no
  // conversion and no rate lookup.
  currency: BASE_CURRENCY,
  notifications: {
    tripReminders: true,
    priceAlerts: false,
  },
};

/** Merges stored values over the defaults so a partial or older record still loads. */
function withDefaults(stored: Partial<AppSettings> | null): AppSettings {
  return {
    theme: stored?.theme ?? DEFAULT_SETTINGS.theme,
    // Validated rather than merged, unlike `theme` above. A currency that is no
    // longer offered would otherwise reach the formatter and be silently shown
    // as dollars under the wrong label; here it resolves to the default and
    // the picker agrees with the prices beside it.
    currency: isCurrencyCode(stored?.currency) ? stored.currency : DEFAULT_SETTINGS.currency,
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...(stored?.notifications ?? {}),
    },
  };
}

export const settingsService = {
  getSettings(): AppSettings {
    return withDefaults(storageService.get<Partial<AppSettings> | null>(STORAGE_KEYS.settings, null));
  },

  saveSettings(settings: AppSettings): void {
    storageService.set(STORAGE_KEYS.settings, settings);
  },

  subscribe(listener: () => void): () => void {
    return storageService.subscribe(STORAGE_KEYS.settings, listener);
  },

  /** What the app is using on this device, for the storage section. */
  getStorageUsage(): StorageEntryUsage[] {
    return storageService.usage();
  },
};
