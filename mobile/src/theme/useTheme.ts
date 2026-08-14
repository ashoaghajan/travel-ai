import { useContext } from 'react';
import { ThemeContext } from './ThemeContext';
import type { Theme } from './tokens';

/**
 * The current theme.
 *
 * Its own module, not an export beside `ThemeProvider`: Fast Refresh only
 * re-renders a file that exports components and nothing else, so a hook living
 * next to the provider quietly costs every theme change a full reload.
 *
 * Throws rather than falling back to a default. A component rendered outside
 * the provider would otherwise paint light-theme colours on a dark device and
 * look like a styling bug, which is a much longer search than a named error.
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);

  if (!theme) throw new Error('useTheme was called outside ThemeProvider.');

  return theme;
}
