/*
 * Node types for this file alone, rather than adding "node" to the project's
 * `types`. See `src/styles/tokens.test.ts` for the same reasoning: this is one
 * of two files under `src/` that touch the filesystem, and granting the whole
 * browser project node globals to serve them would make `import fs from
 * 'node:fs'` typecheck cleanly inside a React component.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The mobile app holds a copy of this app's platform-free logic, and this is
 * what stops the two silently becoming different programs.
 *
 * **The copy is temporary and deliberate.** Extracting a shared `core/`
 * workspace up front would have meant refactoring a working web app before the
 * mobile one had proved the code even runs on Hermes. So the duplication was
 * accepted with a condition: it has to be *visible*. A file that drifts fails
 * here, naming itself, rather than being discovered as a bug on one platform
 * six weeks later.
 *
 * Two lists. `IDENTICAL` must match byte for byte. `ADAPTED` must **not** —
 * each differs for a reason the platform forces, and each says so in a
 * `DIFFERS FROM WEB` comment. Asserting they still differ is not pedantry: it
 * catches somebody "fixing" the drift by copying the web version over the top,
 * which would compile, bundle, and then fail on a device.
 *
 * When `core/` is finally extracted, this file is deleted along with the
 * duplication it guards.
 */

const root = new URL('../../', import.meta.url);

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

/** Copied verbatim: web path → mobile path. */
const IDENTICAL: [string, string][] = [
  ...['booking', 'bytes', 'currency', 'cx', 'date', 'duration', 'flag', 'intent', 'map', 'trip'].map(
    (name): [string, string] => [`src/utils/${name}.ts`, `mobile/src/core/utils/${name}.ts`],
  ),
  ...['booking', 'planner', 'settings', 'travel', 'trip'].map(
    (name): [string, string] => [
      `src/types/${name}.types.ts`,
      `mobile/src/core/types/${name}.types.ts`,
    ],
  ),
];

/** Deliberately different, and why. */
const ADAPTED: [string, string, string][] = [
  ['src/utils/id.ts', 'mobile/src/core/utils/id.ts', 'Hermes has no crypto.randomUUID'],
  [
    'src/services/http.ts',
    'mobile/src/core/services/http.ts',
    'absolute base URL, expo/fetch streaming, AbortError by name, no cookie',
  ],
  [
    'src/services/localStorage.service.ts',
    'mobile/src/core/services/localStorage.service.ts',
    'MMKV backing store, and no cross-tab listener',
  ],
];

describe('the mobile copies have not drifted', () => {
  it.each(IDENTICAL)('%s is copied verbatim', (web, mobile) => {
    expect(read(mobile)).toBe(read(web));
  });
});

describe('the adapted files are still adapted', () => {
  it.each(ADAPTED)('%s differs — %s', (web, mobile) => {
    expect(read(mobile)).not.toBe(read(web));
  });

  it.each(ADAPTED)('%s says why it differs', (_web, mobile) => {
    // Every deviation is annotated at the point of deviation, so the next
    // reader does not have to diff two files to find out what changed.
    expect(read(mobile)).toMatch(/DIFFERS FROM WEB|A copy of/);
  });
});
