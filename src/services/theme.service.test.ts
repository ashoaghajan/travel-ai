/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemePreference } from '../types/settings.types';
import { applyTheme, DARK_QUERY, resolveTheme, watchSystemTheme } from './theme.service';

/**
 * A controllable `matchMedia`.
 *
 * The shared stub in `test/setup.ts` answers "no" to everything, which is the
 * right default but useless for testing the one preference that asks a
 * question. This one lets a test say what the OS wants and then change its
 * mind, which is what `system` has to survive.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const query = {
    media: DARK_QUERY,
    matches,
    addEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
  };

  const matchMedia = vi.fn(() => query as unknown as MediaQueryList);
  vi.stubGlobal('matchMedia', matchMedia);

  return {
    query,
    matchMedia,
    /** Pretend the OS appearance changed. */
    change(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTheme', () => {
  it('takes an explicit choice at face value', () => {
    stubMatchMedia(true);

    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('asks the OS when the choice is system', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');

    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('queries the colour-scheme preference, not something else', () => {
    const media = stubMatchMedia(false);

    resolveTheme('system');

    expect(media.matchMedia).toHaveBeenCalledWith(DARK_QUERY);
  });

  // `settingsService` merges stored values over defaults without validating
  // them, so a hand-edited record really can arrive holding nonsense.
  it('falls back to light for a value that is not a preference at all', () => {
    expect(resolveTheme('purple' as ThemePreference)).toBe('light');
    expect(resolveTheme(undefined as unknown as ThemePreference)).toBe('light');
  });

  // Absent in jsdom and in any non-browser context; its absence has to mean
  // "no opinion", not a crash.
  it('treats a missing matchMedia as no preference', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyTheme', () => {
  it('puts the resolved theme where the stylesheet looks for it', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('repoints the browser chrome colour at the page background', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#6d3fef';
    document.head.append(meta);

    applyTheme('dark');
    expect(meta.content).toBe('#0f1117');

    applyTheme('light');
    expect(meta.content).toBe('#6d3fef');
  });

  it('does not mind if there is no theme-color meta tag', () => {
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('watchSystemTheme', () => {
  it('reports the new theme when the OS appearance changes', () => {
    const media = stubMatchMedia(false);
    const listener = vi.fn();

    watchSystemTheme(listener);
    media.change(true);

    expect(listener).toHaveBeenCalledWith('dark');

    media.change(false);
    expect(listener).toHaveBeenLastCalledWith('light');
  });

  // StrictMode mounts effects twice in development; a leaked listener would go
  // on theming for a component that no longer exists.
  it('stops listening once unsubscribed', () => {
    const media = stubMatchMedia(false);
    const listener = vi.fn();

    watchSystemTheme(listener)();
    media.change(true);

    expect(listener).not.toHaveBeenCalled();
    expect(media.listenerCount()).toBe(0);
  });

  it('returns a usable unsubscribe even with no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(() => watchSystemTheme(vi.fn())()).not.toThrow();
  });
});
