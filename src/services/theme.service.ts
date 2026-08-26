import type { Appearance } from '../types/settings.types';
import { DEFAULT_APPEARANCE, isAppearance } from '../types/settings.types';

/**
 * Turning a stored choice into a painted look.
 *
 * No React component may import this file.
 *
 * Two independent axes, and keeping them independent is the point:
 *
 * - **Appearance** is chosen by the reader — `sharpen`, `atlas`, `console`.
 * - **Ground** is light or dark, and the reader does not choose it at all.
 *   The operating system does, the way it does for every other app.
 *
 * This used to be one axis with three values (`system`/`light`/`dark`). When
 * the appearances replaced it, the light/dark question did not disappear — it
 * stopped being a preference and became something read from the device. Which
 * is why `watchSystemGround` is now unconditional, where the old
 * `watchSystemTheme` only ran while the preference said `system`.
 *
 * Everything downstream works on the resolved pair, so no stylesheet has to
 * consult `prefers-color-scheme`: by the time CSS sees it, both are settled.
 */

/** The ground, once the device has been asked. */
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

/** The ground to paint, asked of the device rather than of the settings. */
export function resolveGround(): ResolvedTheme {
  return prefersDark() ? 'dark' : 'light';
}

/**
 * The appearance to paint for a stored value.
 *
 * Anything unrecognised falls back to `sharpen`. That is not defensive
 * decoration: `settingsService` merges stored values over defaults without
 * validating them, so every record written before the appearances existed
 * arrives here holding `'system'`, `'light'` or `'dark'`. All three land on
 * `sharpen`, which is the look those records were already being shown.
 */
export function resolveAppearance(stored: unknown): Appearance {
  return isAppearance(stored) ? stored : DEFAULT_APPEARANCE;
}

/**
 * Browser-chrome colours, matching each look's page background.
 *
 * Literals, and they have to be: `theme-color` is read by the browser before
 * any stylesheet is parsed, so `var(--color-background)` would resolve to
 * nothing. Keep these in step with `tokens.css` by hand — the pre-paint script
 * in `index.html` carries the same table for the same reason.
 */
const THEME_COLOR: Record<Appearance, Record<ResolvedTheme, string>> = {
  sharpen: { light: '#6d3fef', dark: '#0f1117' },
  atlas: { light: '#fdfcf9', dark: '#17150f' },
  console: { light: '#f4f5f8', dark: '#101318' },
};

/**
 * Paint it.
 *
 * The attribute is the only handle the stylesheet needs. `theme-color` is
 * updated alongside so the browser's own chrome — the address bar on mobile,
 * the title bar of an installed app — stops being brand purple over a dark
 * page.
 */
export function applyTheme(appearance: Appearance, ground: ResolvedTheme): void {
  if (typeof document === 'undefined') return;

  document.documentElement.dataset.appearance = appearance;
  document.documentElement.dataset.theme = ground;

  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[appearance][ground]);
}

/**
 * Follow the device's light/dark setting. Always — nothing opts out of it now.
 *
 * Returns an unsubscribe. Callers must use it: `StrictMode` mounts effects
 * twice in development, and a leaked listener would paint on behalf of a
 * component that no longer exists.
 */
export function watchSystemGround(listener: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const query = window.matchMedia(DARK_QUERY);
  const handle = (event: MediaQueryListEvent) => listener(event.matches ? 'dark' : 'light');

  query.addEventListener('change', handle);

  return () => query.removeEventListener('change', handle);
}
