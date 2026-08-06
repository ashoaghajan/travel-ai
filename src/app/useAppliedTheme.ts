import { useEffect, useState } from 'react';
import { applyTheme, resolveTheme, watchSystemTheme } from '../services/theme.service';
import { settingsService } from '../services/settings.service';
import type { ThemePreference } from '../types/settings.types';

/**
 * Keeps the painted theme in step with the stored preference.
 *
 * Called once, from `App`. There is no context and no provider because nothing
 * renders differently per theme — the only consumer is `data-theme` on the
 * document element, which every stylesheet reads for free.
 *
 * The inline script in `index.html` has already painted the correct theme
 * before React mounted; this hook exists for the three things that script
 * cannot do, being a one-shot: react to the settings screen, to another tab,
 * and to the reader changing their OS appearance while the app is open.
 */
export function useAppliedTheme(): void {
  const [preference, setPreference] = useState<ThemePreference>(
    () => settingsService.getSettings().theme,
  );

  // `subscribe` covers same-tab writes as well as `storage` events, so this is
  // also how the settings screen's choice reaches the document element.
  useEffect(
    () =>
      settingsService.subscribe(() => {
        setPreference(settingsService.getSettings().theme);
      }),
    [],
  );

  useEffect(() => {
    applyTheme(resolveTheme(preference));

    // Only `system` delegates to the OS; the other two have made their choice
    // and must not be overridden when the reader's appearance schedule fires.
    return preference === 'system' ? watchSystemTheme(applyTheme) : undefined;
  }, [preference]);
}
