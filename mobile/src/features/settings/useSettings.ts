import { useCallback, useEffect, useState } from 'react';
import type { TravelPreferences } from '../../core/types/planner.types';
import type { AppSettings, NotificationSettings } from '../../core/types/settings.types';
import { settingsService } from '../../core/services/settings.service';

const SAVE_ERROR = 'We could not save that preference. Please try again.';

/**
 * Reads and writes app preferences.
 *
 * The same hook as `src/features/settings/useSettings.ts`, differing only in
 * the two import paths — the core copies live under `core/` on this side. It
 * is not in `core-copies.test.ts` because that guard covers platform-free
 * *services* and stores, and a hook that a screen imports is neither.
 *
 * Changes persist immediately — there is no separate save step for a handful
 * of toggles. They go to the account rather than to this device, so a currency
 * chosen here is the currency the laptop shows.
 *
 * The switch moves as soon as it is pressed and moves back if the save fails.
 * Waiting for the round trip would make every toggle feel broken on a slow
 * connection; leaving it moved after a failure would show a preference that
 * was never stored, which is worse.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => settingsService.getSettings());
  const [error, setError] = useState<string | null>(null);

  // Preferences arriving with the account at boot, or adopted after a sign-in
  // on this device.
  useEffect(
    () =>
      settingsService.subscribe(() => {
        setSettings(settingsService.getSettings());
      }),
    [],
  );

  const update = useCallback(async (patch: Partial<AppSettings>) => {
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
  }, []);

  const setNotification = useCallback(
    (key: keyof NotificationSettings, value: boolean) => {
      void update({
        notifications: { ...settingsService.getSettings().notifications, [key]: value },
      });
    },
    [update],
  );

  /**
   * One planning preference, merged over the rest.
   *
   * Sent whole rather than as the single changed field, and that is
   * deliberate: the two budgets are clearable, so the server distinguishes an
   * absent key from a null one. Sending the merged object means a null in it
   * always means "no ceiling" and never "I forgot to mention this".
   */
  const setTravel = useCallback(
    (patch: Partial<TravelPreferences>) => {
      const current = settingsService.getSettings().travel;

      void update({
        travel: {
          ...current,
          ...patch,
          categoryWeights: { ...current.categoryWeights, ...patch.categoryWeights },
          meals: { ...current.meals, ...patch.meals },
        },
      });
    },
    [update],
  );

  return { settings, error, update, setNotification, setTravel };
}
