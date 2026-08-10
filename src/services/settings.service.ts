import { BASE_CURRENCY, isCurrencyCode } from '@ai-travel/shared';
import type { ApiSettings } from '@ai-travel/shared';
import type { AppSettings } from '../types/settings.types';
import { http } from './http';
import type { StorageEntryUsage } from './localStorage.service';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * App preferences.
 *
 * The account owns these now, so a currency chosen on a laptop is the currency
 * a phone shows. But `localStorage` did not stop mattering — it became a cache
 * with one specific job.
 *
 * **The theme has to be known before the first frame.** The blocking script in
 * `index.html` reads this key and paints `data-theme` before React exists;
 * without it, a dark-theme reader is shown a white page on every load. Nothing
 * fetched can meet that deadline, so the last known settings stay on disk and
 * the server refreshes them a moment later.
 *
 * That makes `getSettings()` synchronous and possibly one load stale, which is
 * exactly right for what reads it. Writes go to the server first and update
 * the cache from its response.
 */

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  // The currency prices are already quoted in, so the default costs no
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

/** The wire shape and the local shape agree, so this only has to narrow. */
function fromApi(settings: ApiSettings): AppSettings {
  return withDefaults(settings as Partial<AppSettings>);
}

function writeCache(settings: AppSettings): void {
  try {
    storageService.set(STORAGE_KEYS.settings, settings);
  } catch {
    // Full or blocked storage. The preference still applied for this session;
    // only the pre-paint read on the next load degrades, and it degrades to
    // the default theme rather than to nothing.
  }
}

export const settingsService = {
  /**
   * The last known settings, synchronously.
   *
   * Reads the cache, never the network — this is what the theme and the
   * currency formatter need before anything has loaded.
   */
  getSettings(): AppSettings {
    return withDefaults(
      storageService.get<Partial<AppSettings> | null>(STORAGE_KEYS.settings, null),
    );
  },

  /**
   * Adopt the settings that came back with the account.
   *
   * Called from the auth store, which already has them: `GET /api/me` carries
   * settings so that starting the app is one request rather than three. This
   * writes them into the cache and notifies subscribers, so the theme and the
   * currency correct themselves within a frame of signing in.
   */
  adopt(settings: ApiSettings): AppSettings {
    const next = fromApi(settings);
    writeCache(next);

    return next;
  },

  /** Re-read from the server, for a change made on another device. */
  async load(): Promise<AppSettings> {
    const settings = fromApi(await http.get<ApiSettings>('/settings'));
    writeCache(settings);

    return settings;
  },

  /**
   * Save one or more preferences.
   *
   * The server answers with the whole record rather than the patch, so the
   * cache is replaced with what it holds rather than merged towards it — a
   * merge is how a screen ends up showing a preference the database does not
   * have.
   */
  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const settings = fromApi(await http.put<ApiSettings>('/settings', patch));
    writeCache(settings);

    return settings;
  },

  /**
   * Forget the cached copy.
   *
   * Sign-out: the next person at this browser must not have the previous
   * reader's theme painted for them before their own settings arrive.
   */
  clearCache(): void {
    storageService.remove(STORAGE_KEYS.settings);
  },

  subscribe(listener: () => void): () => void {
    return storageService.subscribe(STORAGE_KEYS.settings, listener);
  },

  /** What the app is using on this device, for the storage section. */
  getStorageUsage(): StorageEntryUsage[] {
    return storageService.usage();
  },
};
