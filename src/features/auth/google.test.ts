/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleClientId } from './google';

/**
 * Loading Google's script.
 *
 * jsdom does not fetch `<script src>`, so the tests drive the load and error
 * events by hand — which is the only way to exercise the failure path anyway.
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function scriptTags(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)];
}

/** Pretend GIS finished loading and exposed its client. */
function scriptLoads() {
  window.google = {
    accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), disableAutoSelect: vi.fn() } },
  };

  scriptTags().forEach((script) => script.dispatchEvent(new Event('load')));
}

function scriptFails() {
  scriptTags().forEach((script) => script.dispatchEvent(new Event('error')));
}

beforeEach(async () => {
  document.head.innerHTML = '';
  delete window.google;
  // The module caches its in-flight promise; a fresh registry per test keeps
  // one test's load from satisfying the next.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('googleClientId', () => {
  it('is null when nothing is configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');

    expect(googleClientId()).toBeNull();
  });

  it('is null for a value that is only whitespace', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '   ');

    expect(googleClientId()).toBeNull();
  });

  it('returns the configured id', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'abc.apps.googleusercontent.com');

    expect(googleClientId()).toBe('abc.apps.googleusercontent.com');
  });
});

describe('loadGoogleIdentityServices', () => {
  it('adds the script and resolves once it has loaded', async () => {
    const { loadGoogleIdentityServices: load } = await import('./google');
    const pending = load();

    expect(scriptTags()).toHaveLength(1);
    scriptLoads();

    await expect(pending).resolves.toHaveProperty('accounts.id.initialize');
  });

  // Two buttons on one page, or a remount, must not add a second script tag.
  it('adds only one script however many callers ask', async () => {
    const { loadGoogleIdentityServices: load } = await import('./google');
    const first = load();
    const second = load();

    expect(scriptTags()).toHaveLength(1);
    scriptLoads();

    await Promise.all([first, second]);
    expect(scriptTags()).toHaveLength(1);
  });

  it('resolves immediately when GIS is already present', async () => {
    scriptLoads();
    const { loadGoogleIdentityServices: load } = await import('./google');

    await expect(load()).resolves.toBeDefined();
    expect(scriptTags()).toHaveLength(0);
  });

  it('rejects when the script cannot load', async () => {
    const { loadGoogleIdentityServices: load } = await import('./google');
    const pending = load();

    scriptFails();

    await expect(pending).rejects.toThrow('Could not load Google Identity Services');
  });

  // A blocked or flaky first load should not disable the button for the rest
  // of the session.
  it('lets a later attempt try again after a failure', async () => {
    const { loadGoogleIdentityServices: load } = await import('./google');
    const first = load();
    scriptFails();
    await expect(first).rejects.toThrow();

    document.head.innerHTML = '';
    const second = load();
    expect(scriptTags()).toHaveLength(1);

    scriptLoads();
    await expect(second).resolves.toBeDefined();
  });

  it('rejects when the script loads but exposes nothing', async () => {
    const { loadGoogleIdentityServices: load } = await import('./google');
    const pending = load();

    scriptTags().forEach((script) => script.dispatchEvent(new Event('load')));

    await expect(pending).rejects.toThrow('exposed no client');
  });
});

// Loading it a second time must not re-declare the global type or re-run the
// side effect; this pins that `loadGoogleIdentityServices` is idempotent
// across module reloads too.
describe('the script tag itself', () => {
  it('is async and deferred, so it never blocks the form', async () => {
    const { loadGoogleIdentityServices: load } = await import('./google');
    void load();

    const [script] = scriptTags();
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
  });
});
