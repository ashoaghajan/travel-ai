import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeContext } from './ThemeContext';
import { themeFor } from './tokens';
import type { ColorScheme } from './tokens';

/**
 * The resolved theme, for everything below it.
 *
 * **`preference` is the stored choice; the scheme is what gets painted.** The
 * web app draws that same distinction in `theme.service.ts`, and for the same
 * reason: `'system'` is a thing somebody can choose but not a thing that can
 * be rendered, so exactly one place is allowed to resolve it. That place is
 * here.
 *
 * The preference is a prop rather than read from storage, because storage does
 * not exist on this side yet — the settings store arrives with the rest of the
 * core plumbing. Until then the caller passes `'system'` and the OS decides.
 * When it does arrive, this component does not change.
 */

export type ThemePreference = ColorScheme | 'system';

export function ThemeProvider({
  preference = 'system',
  children,
}: {
  preference?: ThemePreference;
  children: ReactNode;
}) {
  /*
   * The OS answers `'light'`, `'dark'`, `'unspecified'`, or null — and only
   * the first two are things that can be painted. Anything else falls back to
   * light, matching the web's `resolveTheme`, so a device that declines to
   * answer gets the same app as one that answers "light".
   */
  const reported = useColorScheme();
  const system: ColorScheme = reported === 'dark' ? 'dark' : 'light';
  const scheme: ColorScheme = preference === 'system' ? system : preference;

  // Rebuilt only when the resolved scheme actually changes: every styled
  // component below reads this, so an identity change on each render would
  // invalidate all of them.
  const theme = useMemo(() => themeFor(scheme), [scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
