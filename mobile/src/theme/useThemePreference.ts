import { useEffect, useState } from 'react';
import { settingsService } from '../core/services/settings.service';
import type { Appearance } from '../core/types/settings.types';
import { DEFAULT_APPEARANCE, isAppearance } from '../core/types/settings.types';

/**
 * The stored theme choice, kept in step with the settings screen.
 *
 * The web's equivalent is `src/app/useAppliedTheme.ts`, and it is longer for a
 * reason that does not apply here: on the web this hook also has to *paint*,
 * setting `data-theme` on the document element and subscribing to the OS
 * appearance when the choice is `'system'`. On this side `ThemeProvider`
 * already resolves `'system'` through `useColorScheme()`, so nothing about
 * painting belongs here — this only has to answer what was chosen.
 *
 * Read once synchronously, then kept current by subscription. The synchronous
 * first read is what stops a dark-theme reader seeing a light frame at launch:
 * the cached settings are on disk before the account's arrive from `/api/me`.
 */
/**
 * Narrowed rather than trusted. A record written before the appearances
 * existed holds `'system'`, `'light'` or `'dark'`, and handing one of those to
 * `themeFor` would index `PALETTES` with a key that is not there.
 */
function read(): Appearance {
  const stored = settingsService.getSettings().theme;
  return isAppearance(stored) ? stored : DEFAULT_APPEARANCE;
}

export function useThemePreference(): Appearance {
  const [preference, setPreference] = useState<Appearance>(() => read());

  /*
   * Covers both writers: the settings screen on this device, and `adopt()`
   * when the account's own settings land a moment after sign-in.
   */
  useEffect(
    () =>
      settingsService.subscribe(() => {
        setPreference(read());
      }),
    [],
  );

  return preference;
}
