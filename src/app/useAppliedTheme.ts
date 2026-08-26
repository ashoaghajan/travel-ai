import { useEffect, useState } from 'react';
import {
  applyTheme,
  resolveAppearance,
  resolveGround,
  watchSystemGround,
} from '../services/theme.service';
import { settingsService } from '../services/settings.service';
import type { Appearance } from '../types/settings.types';

/**
 * Keeps the painted look in step with the stored appearance and the device.
 *
 * Called once, from `App`. There is no context and no provider because nothing
 * renders differently per look — the only consumers are `data-appearance` and
 * `data-theme` on the document element, which every stylesheet reads for free.
 *
 * The inline script in `index.html` has already painted both before React
 * mounted; this hook exists for the three things that script cannot do, being
 * a one-shot: react to the settings screen, to another tab, and to the reader
 * changing their OS appearance while the app is open.
 *
 * The OS watch is unconditional now. Under the old `system`/`light`/`dark`
 * preference it ran only while the choice was `system`, because the other two
 * had opted out of the device. Nothing opts out any more: light and dark are
 * no longer a preference, so the device is always the authority on the ground.
 */
export function useAppliedTheme(): void {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    resolveAppearance(settingsService.getSettings().theme),
  );

  // `subscribe` covers same-tab writes as well as `storage` events, so this is
  // also how the settings screen's choice reaches the document element.
  useEffect(
    () =>
      settingsService.subscribe(() => {
        setAppearance(resolveAppearance(settingsService.getSettings().theme));
      }),
    [],
  );

  useEffect(() => {
    applyTheme(appearance, resolveGround());

    return watchSystemGround((ground) => applyTheme(appearance, ground));
  }, [appearance]);
}
