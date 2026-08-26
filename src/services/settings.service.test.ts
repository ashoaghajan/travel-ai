/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { DEFAULT_SETTINGS, settingsService } from './settings.service';
import { ApiError, http } from './http';

/**
 * App preferences.
 *
 * The account owns these now, but `localStorage` still holds a copy — and that
 * copy has one specific job: the blocking script in `index.html` reads it to
 * paint the theme before the first frame. Nothing fetched can meet that
 * deadline, so `getSettings()` stays synchronous and possibly one load stale,
 * while writes go to the server and refresh the cache from its answer.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('getSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(settingsService.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  // Sharpen and not one of the other two: it is the look the app already had,
  // so nobody's interface changes character because they never opened Settings.
  it('defaults to the Sharpen appearance', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('sharpen');
  });

  it('defaults to the currency every price is already quoted in', () => {
    expect(DEFAULT_SETTINGS.currency).toBe('USD');
  });

  it('discards a stored currency that is no longer offered', () => {
    storageService.set(STORAGE_KEYS.settings, { currency: 'XBT' });

    // Left alone it would reach the formatter, fall back to dollars, and be
    // shown under a currency the picker cannot even display.
    expect(settingsService.getSettings().currency).toBe('USD');
  });

  it('returns what the account was last known to hold', () => {
    settingsService.adopt({
      theme: 'atlas',
      currency: 'AMD',
      notifications: { tripReminders: false, priceAlerts: true },
    });

    expect(settingsService.getSettings()).toEqual({
      theme: 'atlas',
      currency: 'AMD',
      notifications: { tripReminders: false, priceAlerts: true },
    });
  });

  it('fills in missing fields from the defaults', () => {
    storageService.set(STORAGE_KEYS.settings, { theme: 'console' });

    expect(settingsService.getSettings()).toEqual({
      theme: 'console',
      currency: DEFAULT_SETTINGS.currency,
      notifications: DEFAULT_SETTINGS.notifications,
    });
  });

  it('fills in a partially stored notifications object', () => {
    storageService.set(STORAGE_KEYS.settings, { notifications: { priceAlerts: true } });

    const settings = settingsService.getSettings();
    expect(settings.notifications.priceAlerts).toBe(true);
    expect(settings.notifications.tripReminders).toBe(DEFAULT_SETTINGS.notifications.tripReminders);
  });

  it('falls back to the defaults on a corrupt record', () => {
    localStorage.setItem(STORAGE_KEYS.settings, 'not json');
    expect(settingsService.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('adopt', () => {
  it('caches what came back with the account', () => {
    settingsService.adopt({ ...DEFAULT_SETTINGS, theme: 'atlas' });

    // Written synchronously, because the next page load's blocking script
    // reads this key before anything could be fetched.
    expect(localStorage.getItem(STORAGE_KEYS.settings)).not.toBeNull();
    expect(settingsService.getSettings().theme).toBe('atlas');
  });
});

describe('save', () => {
  it('sends only the fields that changed', async () => {
    const put = vi.spyOn(http, 'put').mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'atlas' });

    await settingsService.save({ theme: 'atlas' });

    // The settings screen writes one toggle at a time; the server merges.
    expect(put).toHaveBeenCalledWith('/settings', { theme: 'atlas' });
  });

  it('caches what the server answered, not what was sent', async () => {
    vi.spyOn(http, 'put').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      theme: 'atlas',
      currency: 'AMD',
    });

    await settingsService.save({ theme: 'atlas' });

    // The response is the whole record. Merging towards it instead is how a
    // screen ends up showing a preference the database does not hold.
    expect(settingsService.getSettings().currency).toBe('AMD');
  });

  it('leaves the cache alone when the save fails', async () => {
    settingsService.adopt({ ...DEFAULT_SETTINGS, theme: 'console' });
    vi.spyOn(http, 'put').mockRejectedValue(new ApiError(502, 'INTERNAL' as never, 'Nope.'));

    await expect(settingsService.save({ theme: 'atlas' })).rejects.toBeInstanceOf(ApiError);

    // A preference on screen that was never stored is worse than one that
    // visibly refused to change.
    expect(settingsService.getSettings().theme).toBe('console');
  });

  it('survives storage refusing the write', async () => {
    vi.spyOn(http, 'put').mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'atlas' });
    vi.spyOn(storageService, 'set').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // The preference applied for this session; only the pre-paint read on the
    // next load degrades, and it degrades to the default theme.
    await expect(settingsService.save({ theme: 'atlas' })).resolves.toMatchObject({
      theme: 'atlas',
    });
  });
});

describe('load', () => {
  it('refreshes the cache from the server', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ ...DEFAULT_SETTINGS, currency: 'EUR' });

    await settingsService.load();

    expect(settingsService.getSettings().currency).toBe('EUR');
  });
});

describe('clearCache', () => {
  it('forgets the previous reader’s preferences', () => {
    settingsService.adopt({ ...DEFAULT_SETTINGS, theme: 'atlas' });

    settingsService.clearCache();

    // Sign-out: the next person at this browser must not have someone else's
    // theme painted for them before their own settings arrive.
    expect(settingsService.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('subscribe', () => {
  it('fires when preferences change', () => {
    const listener = vi.fn();
    const unsubscribe = settingsService.subscribe(listener);

    settingsService.adopt({ ...DEFAULT_SETTINGS, theme: 'atlas' });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fires when another tab changes preferences', () => {
    const listener = vi.fn();
    const unsubscribe = settingsService.subscribe(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.settings }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('getStorageUsage', () => {
  it('reports every app key so pages never touch storage directly', () => {
    const usage = settingsService.getStorageUsage();

    expect(usage.map((entry) => entry.key).sort()).toEqual(Object.values(STORAGE_KEYS).sort());
  });
});

/*
 * The one-way door out of the old preference.
 *
 * These records exist on real devices — anyone who opened the app before the
 * appearances shipped has one — and the value in them is no longer a look. Left
 * alone it would reach `data-appearance` and select no palette at all, so the
 * page would paint half of one look over the ground of another.
 */
describe('records written before the appearances existed', () => {
  it.each(['system', 'light', 'dark'])('reads a stored %s as Sharpen', (retired) => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: retired }),
    );

    expect(settingsService.getSettings().theme).toBe('sharpen');
  });

  it('reads outright nonsense as Sharpen too', () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'purple' }),
    );

    expect(settingsService.getSettings().theme).toBe('sharpen');
  });

  // The rest of the record is still good: a migration must not cost somebody
  // their currency because one neighbouring field went out of date.
  it('keeps everything else in the record', () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        theme: 'dark',
        currency: 'AMD',
        notifications: { tripReminders: false, priceAlerts: true },
      }),
    );

    const settings = settingsService.getSettings();

    expect(settings.theme).toBe('sharpen');
    expect(settings.currency).toBe('AMD');
    expect(settings.notifications).toEqual({ tripReminders: false, priceAlerts: true });
  });
});
