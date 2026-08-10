/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';
import { settingsService } from '../services/settings.service';
import { DARK_QUERY } from '../services/theme.service';
import type { ThemePreference } from '../types/settings.types';
import { useAppliedTheme } from './useAppliedTheme';

/**
 * The wiring, not the resolver.
 *
 * `theme.service.test.ts` already covers what a preference resolves to; these
 * tests are about the three things that only exist once the hook is mounted —
 * the settings screen reaching the document element, another tab doing the
 * same, and the OS changing its mind under a `system` preference.
 */

/** A `matchMedia` whose answer can change after the fact. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const query = {
    media: DARK_QUERY,
    matches,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query as unknown as MediaQueryList),
  );

  return {
    listenerCount: () => listeners.size,
    change(next: boolean) {
      query.matches = next;
      act(() => {
        listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
      });
    },
  };
}

function Harness() {
  useAppliedTheme();

  return null;
}

/**
 * Writes a preference the way the settings screen does.
 *
 * Through `adopt`, which is the cache write the screen's save ends in — the
 * theme is painted from the cache, because the blocking script in `index.html`
 * has to know it before any request could have finished.
 */
function choose(theme: ThemePreference) {
  act(() => {
    settingsService.adopt({ ...settingsService.getSettings(), theme });
  });
}

const painted = () => document.documentElement.dataset.theme;

beforeEach(() => {
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAppliedTheme', () => {
  it('paints the stored preference on mount', () => {
    stubMatchMedia(false);
    settingsService.adopt({ ...settingsService.getSettings(), theme: 'dark' });

    render(<Harness />);

    expect(painted()).toBe('dark');
  });

  it('repaints when the settings screen changes the preference', () => {
    stubMatchMedia(false);
    render(<Harness />);
    expect(painted()).toBe('light');

    choose('dark');
    expect(painted()).toBe('dark');

    choose('light');
    expect(painted()).toBe('light');
  });

  // The default preference, and the only one that keeps listening.
  it('follows the OS while the preference is system', () => {
    const media = stubMatchMedia(false);
    render(<Harness />);
    expect(painted()).toBe('light');

    media.change(true);
    expect(painted()).toBe('dark');

    media.change(false);
    expect(painted()).toBe('light');
  });

  // The whole point of an explicit choice: a reader who picked light keeps it
  // when their appearance schedule flips at sunset.
  it('ignores the OS once a theme is chosen explicitly', () => {
    const media = stubMatchMedia(false);
    render(<Harness />);

    choose('light');
    media.change(true);

    expect(painted()).toBe('light');
  });

  it('stops listening to the OS when the preference leaves system', () => {
    const media = stubMatchMedia(false);
    render(<Harness />);
    expect(media.listenerCount()).toBe(1);

    choose('dark');
    expect(media.listenerCount()).toBe(0);

    choose('system');
    expect(media.listenerCount()).toBe(1);
  });

  // A leaked listener would paint on behalf of an unmounted tree, and
  // `StrictMode` mounts every effect twice in development.
  it('leaves nothing subscribed after unmount', () => {
    const media = stubMatchMedia(false);
    const { unmount } = render(<Harness />);

    unmount();

    expect(media.listenerCount()).toBe(0);
  });
});
