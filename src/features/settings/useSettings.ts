import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, NotificationSettings } from '../../types/settings.types';
import { settingsService } from '../../services/settings.service';

const SAVE_ERROR = 'We could not save that preference. Your browser storage may be blocked.';

/**
 * Reads and writes app preferences. Changes persist immediately — there is no
 * separate save step for a handful of toggles.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => settingsService.getSettings());
  const [error, setError] = useState<string | null>(null);

  // Preferences changed in another tab.
  useEffect(
    () =>
      settingsService.subscribe(() => {
        setSettings(settingsService.getSettings());
      }),
    [],
  );

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };

      try {
        settingsService.saveSettings(next);
        setSettings(next);
        setError(null);
      } catch {
        // Keep the previous value on screen rather than showing a preference
        // that was never stored.
        setError(SAVE_ERROR);
      }
    },
    [settings],
  );

  const setNotification = useCallback(
    (key: keyof NotificationSettings, value: boolean) => {
      update({ notifications: { ...settings.notifications, [key]: value } });
    },
    [settings, update],
  );

  return { settings, error, update, setNotification };
}
