/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { DEFAULT_SETTINGS, settingsService } from './settings.service';

describe('getSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(settingsService.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to the system theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
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

  it('returns what was saved', () => {
    settingsService.saveSettings({
      theme: 'dark',
      currency: 'AMD',
      notifications: { tripReminders: false, priceAlerts: true },
    });

    expect(settingsService.getSettings()).toEqual({
      theme: 'dark',
      currency: 'AMD',
      notifications: { tripReminders: false, priceAlerts: true },
    });
  });

  it('fills in missing fields from the defaults', () => {
    storageService.set(STORAGE_KEYS.settings, { theme: 'light' });

    expect(settingsService.getSettings()).toEqual({
      theme: 'light',
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

describe('saveSettings', () => {
  it('writes under the settings key', () => {
    settingsService.saveSettings(DEFAULT_SETTINGS);
    expect(localStorage.getItem(STORAGE_KEYS.settings)).not.toBeNull();
  });
});

describe('subscribe', () => {
  it('fires when preferences change', () => {
    const listener = vi.fn();
    const unsubscribe = settingsService.subscribe(listener);

    settingsService.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });

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
