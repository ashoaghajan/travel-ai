import { afterEach, beforeEach } from 'vitest';

/**
 * Test environment setup.
 *
 * The suite runs in Node by default; files that need a DOM opt in with a
 * `@vitest-environment jsdom` docblock. Everything here is therefore guarded
 * so it works in both.
 *
 * jsdom provides a real `localStorage`, so the storage services are exercised
 * against an actual `Storage` implementation rather than a hand-rolled fake —
 * but that also means state leaks between tests unless it is cleared.
 */
const hasDom = typeof window !== 'undefined';

if (hasDom) {
  await import('@testing-library/jest-dom/vitest');

  // Vitest globals are off, so Testing Library's automatic cleanup is not
  // registered for us.
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });

  /*
   * jsdom implements no `matchMedia` at all, so anything that asks the OS a
   * question — the theme resolver, the planner's reduced-motion check — throws
   * on sight without this.
   *
   * It answers "no" to everything, which is the right default: tests that care
   * about a media query should say so explicitly with `vi.stubGlobal`, rather
   * than inheriting an opinion from here.
   */
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        media: query,
        matches: false,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        // Deprecated, but some libraries still reach for them.
        addListener: () => undefined,
        removeListener: () => undefined,
      }) as MediaQueryList;
  }
}

beforeEach(() => {
  if (hasDom) localStorage.clear();
});
