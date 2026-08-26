/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';
import { settingsService } from '../services/settings.service';
import type { Appearance } from '../types/settings.types';
import { DARK_QUERY } from '../services/theme.service';
import { useAppliedTheme } from './useAppliedTheme';

/**
 * The wiring, not the resolver.
 *
 * `theme.service.test.ts` already covers what a stored value resolves to;
 * these tests are about what only exists once the hook is mounted — the
 * settings screen reaching the document element, another tab doing the same,
 * and the OS changing its mind. That last one used to depend on the preference
 * being `system`; it no longer depends on anything, which is what several of
 * the assertions below now pin down.
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
function choose(theme: Appearance) {
  act(() => {
    settingsService.adopt({ ...settingsService.getSettings(), theme });
  });
}

const painted = () => document.documentElement.dataset.theme;
const look = () => document.documentElement.dataset.appearance;

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.appearance;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAppliedTheme', () => {
  it('paints the stored appearance on mount', () => {
    stubMatchMedia(false);
    settingsService.adopt({ ...settingsService.getSettings(), theme: 'atlas' });

    render(<Harness />);

    expect(look()).toBe('atlas');
    expect(painted()).toBe('light');
  });

  it('repaints when the settings screen changes the appearance', () => {
    stubMatchMedia(false);
    render(<Harness />);
    expect(look()).toBe('sharpen');

    choose('console');
    expect(look()).toBe('console');

    choose('atlas');
    expect(look()).toBe('atlas');
  });

  /*
   * Unconditional now, where this once read "while the preference is system".
   * Light and dark stopped being a preference, so there is no longer any state
   * in which the app declines to follow the device.
   */
  it('follows the OS ground whatever the appearance', () => {
    const media = stubMatchMedia(false);
    render(<Harness />);
    expect(painted()).toBe('light');

    media.change(true);
    expect(painted()).toBe('dark');

    choose('console');
    media.change(false);
    expect(painted()).toBe('light');

    media.change(true);
    expect(painted()).toBe('dark');
  });

  // The two axes are independent: the device owns one, the reader owns the
  // other, and neither may overwrite the other's.
  it('keeps the ground when the appearance changes under a dark OS', () => {
    stubMatchMedia(true);
    render(<Harness />);
    expect(painted()).toBe('dark');

    choose('atlas');

    expect(look()).toBe('atlas');
    expect(painted()).toBe('dark');
  });

  it('keeps exactly one OS listener across an appearance change', () => {
    const media = stubMatchMedia(false);
    render(<Harness />);
    expect(media.listenerCount()).toBe(1);

    choose('atlas');
    expect(media.listenerCount()).toBe(1);

    choose('console');
    expect(media.listenerCount()).toBe(1);
  });

  // A record written before the appearances existed must not reach
  // `data-appearance`, where it would select no palette at all.
  it('paints Sharpen for a retired light/dark preference', () => {
    stubMatchMedia(false);
    settingsService.adopt({
      ...settingsService.getSettings(),
      theme: 'dark' as never,
    });

    render(<Harness />);

    expect(look()).toBe('sharpen');
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
