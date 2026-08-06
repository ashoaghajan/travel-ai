import type { ThemePreference } from '../types/settings.types';

/**
 * Turning a stored preference into a painted theme.
 *
 * No React component may import this file.
 *
 * The preference is one of three things; the *theme* is one of two. Everything
 * downstream — the token block in `tokens.css`, the pre-paint script in
 * `index.html` — works on the resolved pair, so `system` is collapsed here and
 * nowhere else. That is why no stylesheet has to consult
 * `prefers-color-scheme`: by the time CSS sees it, the question is settled.
 */

/** What actually gets painted, as opposed to what the reader asked for. */
export type ResolvedTheme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Whether the OS is asking for dark.
 *
 * `matchMedia` is missing in jsdom and in any non-browser context, so its
 * absence has to mean "no opinion" rather than a crash.
 */
function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * The theme to paint for a preference.
 *
 * Anything unrecognised resolves to light. `settingsService` merges stored
 * values over defaults without validating them, so a hand-edited or
 * older-format record really can arrive here holding something that is not a
 * `ThemePreference` at all.
 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'system') return prefersDark() ? 'dark' : 'light';

  return 'light';
}

/** Browser-chrome colours, matching each theme's page background. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#6d3fef',
  dark: '#0f1117',
};

/**
 * Paint it.
 *
 * The attribute is the only handle the stylesheet needs. `theme-color` is
 * updated alongside so the browser's own chrome — the address bar on mobile,
 * the title bar of an installed app — stops being brand purple over a dark
 * page.
 */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;

  document.documentElement.dataset.theme = theme;

  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme]);
}

/**
 * Follow the OS while the preference is `system`.
 *
 * Returns an unsubscribe. Callers must use it: `StrictMode` mounts effects
 * twice in development, and a leaked listener would apply a theme on behalf of
 * a component that no longer exists.
 */
export function watchSystemTheme(listener: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const query = window.matchMedia(DARK_QUERY);
  const handle = (event: MediaQueryListEvent) => listener(event.matches ? 'dark' : 'light');

  query.addEventListener('change', handle);

  return () => query.removeEventListener('change', handle);
}
