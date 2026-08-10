import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, NotificationSettings } from '../../types/settings.types';
import { settingsService } from '../../services/settings.service';

const SAVE_ERROR = 'We could not save that preference. Please try again.';

/**
 * Reads and writes app preferences.
 *
 * Changes persist immediately — there is no separate save step for a handful
 * of toggles. They go to the account rather than to this browser, so a
 * currency chosen here is the currency a phone shows.
 *
 * The switch moves as soon as it is clicked and moves back if the save fails.
 * Waiting for the round trip would make every toggle feel broken on a slow
 * connection; leaving it moved after a failure would show a preference that
 * was never stored, which is worse.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => settingsService.getSettings());
  const [error, setError] = useState<string | null>(null);

  // Preferences changed in another tab, or arriving with the account at boot.
  useEffect(
    () =>
      settingsService.subscribe(() => {
        setSettings(settingsService.getSettings());
      }),
    [],
  );

  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      const previous = settingsService.getSettings();

      setSettings({ ...previous, ...patch });
      setError(null);

      try {
        // The server answers with the whole record, so this is what it holds
        // rather than what we guessed a moment ago.
        setSettings(await settingsService.save(patch));
      } catch {
        setSettings(previous);
        setError(SAVE_ERROR);
      }
    },
    [],
  );

  const setNotification = useCallback(
    (key: keyof NotificationSettings, value: boolean) => {
      void update({
        notifications: { ...settingsService.getSettings().notifications, [key]: value },
      });
    },
    [update],
  );

  return { settings, error, update, setNotification };
}
