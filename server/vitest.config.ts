import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shared = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Longest first, or the bare specifier swallows the '/schemas' suffix.
      '@ai-travel/shared/schemas': shared('../shared/src/schemas/index.ts'),
      '@ai-travel/shared': shared('../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // One database for the run, and the files must not race over it.
    fileParallelism: false,
    /*
     * The first hook creates the test database and applies every migration
     * against a fresh Postgres, which comfortably outruns the 10-second
     * default on a cold container.
     */
    hookTimeout: 60_000,
    /*
     * Well above the 5-second default.
     *
     * argon2 is expensive on purpose — that is the entire point of it — and
     * these suites run dozens of hashes each. At the default, a loaded machine
     * intermittently times a test out. The slowness is by design; the timeout
     * was simply mis-sized.
     *
     * A timed-out test still skips its `afterEach`, and that used to leave the
     * throttles switched on for every file after it — three later suites
     * failing on 429 where they asserted 422, in modules nobody had touched.
     * `setup.ts` now resets them in a `beforeEach`, which runs whether or not
     * the previous test finished, so one slow test costs one failure.
     */
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/test/**', '**/*.test.ts'],
      // Starting floor, to be ratcheted as the server grows.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
      },
    },
  },
});
