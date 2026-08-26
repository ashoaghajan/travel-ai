import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeContext } from './ThemeContext';
import { themeFor } from './tokens';
import type { ColorScheme } from './tokens';
import type { Appearance } from '../core/types/settings.types';
import { DEFAULT_APPEARANCE } from '../core/types/settings.types';

/**
 * The resolved theme, for everything below it.
 *
 * Two axes, and only one of them is a choice:
 *
 * - **`appearance`** is the reader's — `sharpen`, `atlas`, `console`. It comes
 *   in as a prop from `useThemePreference`, so this component stays a pure
 *   function of what it is given and can be rendered in a test without
 *   storage.
 * - **The ground** is light or dark and belongs to the device. Nobody chooses
 *   it in this app any more; `useColorScheme()` is the only authority.
 *
 * That split is why there is no `'system'` here to resolve. Under the old
 * preference this component collapsed three values into two; now the OS answer
 * *is* the answer, and the web's `theme.service.ts` draws the same line.
 */
export function ThemeProvider({
  appearance = DEFAULT_APPEARANCE,
  children,
}: {
  appearance?: Appearance;
  children: ReactNode;
}) {
  /*
   * The OS answers `'light'`, `'dark'`, `'unspecified'`, or null — and only
   * the first two can be painted. Anything else falls back to light, matching
   * the web's `resolveGround`, so a device that declines to answer gets the
   * same app as one that answers "light".
   */
  const reported = useColorScheme();
  const scheme: ColorScheme = reported === 'dark' ? 'dark' : 'light';

  // Rebuilt only when one of the two actually changes: every styled component
  // below reads this, so an identity change per render would invalidate them all.
  const theme = useMemo(() => themeFor(appearance, scheme), [appearance, scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
