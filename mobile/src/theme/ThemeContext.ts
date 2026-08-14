import { createContext } from 'react';
import type { Theme } from './tokens';

/**
 * Split from both the provider and the hook so neither file exports a mix of
 * components and values — which is what Fast Refresh needs to reload a screen
 * without dropping its state.
 *
 * Null until a provider supplies one, so `useTheme` can tell "no provider"
 * apart from "light theme" and say so.
 */
export const ThemeContext = createContext<Theme | null>(null);
