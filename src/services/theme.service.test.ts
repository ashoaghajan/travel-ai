/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  DARK_QUERY,
  resolveAppearance,
  resolveGround,
  watchSystemGround,
} from './theme.service';

/**
 * A controllable `matchMedia`.
 *
 * The shared stub in `test/setup.ts` answers "no" to everything, which is the
 * right default but useless here: the ground is now *always* a question put to
 * the OS, so every test in this file needs an OS with an opinion it can
 * change.
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
  delete document.documentElement.dataset.appearance;
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveGround', () => {
  it('answers with whatever the device is set to', () => {
    stubMatchMedia(true);
    expect(resolveGround()).toBe('dark');

    stubMatchMedia(false);
    expect(resolveGround()).toBe('light');
  });

  it('queries the colour-scheme preference, not something else', () => {
    const media = stubMatchMedia(false);

    resolveGround();

    expect(media.matchMedia).toHaveBeenCalledWith(DARK_QUERY);
  });

  // Absent in jsdom and in any non-browser context; its absence has to mean
  // "no opinion", not a crash.
  it('treats a missing matchMedia as light', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(resolveGround()).toBe('light');
  });
});

describe('resolveAppearance', () => {
  it('takes any look we ship at face value', () => {
    expect(resolveAppearance('sharpen')).toBe('sharpen');
    expect(resolveAppearance('atlas')).toBe('atlas');
    expect(resolveAppearance('console')).toBe('console');
  });

  /*
   * The migration, and the reason this function exists. Every record written
   * before the appearances holds one of these three, and every one of those
   * readers was being shown what is now called Sharpen — so this is a rename,
   * not the loss of somebody's choice.
   */
  it('reads a retired light/dark preference as Sharpen', () => {
    expect(resolveAppearance('system')).toBe('sharpen');
    expect(resolveAppearance('light')).toBe('sharpen');
    expect(resolveAppearance('dark')).toBe('sharpen');
  });

  // `settingsService` merges stored values over defaults without validating
  // them, so a hand-edited record really can arrive holding nonsense.
  it('falls back to Sharpen for a value that is not a look at all', () => {
    expect(resolveAppearance('purple')).toBe('sharpen');
    expect(resolveAppearance(undefined)).toBe('sharpen');
    expect(resolveAppearance(null)).toBe('sharpen');
    expect(resolveAppearance(7)).toBe('sharpen');
  });
});

describe('applyTheme', () => {
  it('puts both axes where the stylesheet looks for them', () => {
    applyTheme('atlas', 'dark');
    expect(document.documentElement.dataset.appearance).toBe('atlas');
    expect(document.documentElement.dataset.theme).toBe('dark');

    applyTheme('sharpen', 'light');
    expect(document.documentElement.dataset.appearance).toBe('sharpen');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  /*
   * The two axes are independent, and this is the assertion that says so:
   * changing the look must not disturb the ground, because the ground belongs
   * to the device and nothing on the settings screen may overrule it.
   */
  it('leaves the ground alone when only the look changes', () => {
    applyTheme('sharpen', 'dark');
    applyTheme('console', 'dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.appearance).toBe('console');
  });

  it('repoints the browser chrome colour at the page background', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#6d3fef';
    document.head.append(meta);

    applyTheme('sharpen', 'dark');
    expect(meta.content).toBe('#0f1117');

    applyTheme('sharpen', 'light');
    expect(meta.content).toBe('#6d3fef');
  });

  // Each look has its own page background, so each has its own chrome colour.
  it('uses the chrome colour of the look being painted', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    applyTheme('atlas', 'light');
    expect(meta.content).toBe('#fdfcf9');

    applyTheme('console', 'dark');
    expect(meta.content).toBe('#101318');
  });

  it('does not mind if there is no theme-color meta tag', () => {
    expect(() => applyTheme('sharpen', 'dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('watchSystemGround', () => {
  it('reports the new ground when the OS appearance changes', () => {
    const media = stubMatchMedia(false);
    const listener = vi.fn();

    watchSystemGround(listener);
    media.change(true);

    expect(listener).toHaveBeenCalledWith('dark');

    media.change(false);
    expect(listener).toHaveBeenLastCalledWith('light');
  });

  // StrictMode mounts effects twice in development; a leaked listener would go
  // on painting for a component that no longer exists.
  it('stops listening once unsubscribed', () => {
    const media = stubMatchMedia(false);
    const listener = vi.fn();

    watchSystemGround(listener)();
    media.change(true);

    expect(listener).not.toHaveBeenCalled();
    expect(media.listenerCount()).toBe(0);
  });

  it('returns a usable unsubscribe even with no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(() => watchSystemGround(vi.fn())()).not.toThrow();
  });
});
