import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const shared = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Longest first — '@ai-travel/shared' would otherwise swallow the
      // '/schemas' suffix and resolve both to the types entry point.
      '@ai-travel/shared/schemas': shared('./shared/src/schemas/index.ts'),
      '@ai-travel/shared': shared('./shared/src/index.ts'),
    },
  },
  server: {
    // Same-origin in development, which is what makes the httpOnly refresh
    // cookie work without any CORS or SameSite=None concessions.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  test: {
    // Node by default — most of the suite is pure functions. Files that need
    // a DOM (storage-backed services, components) opt in with a
    // `@vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // `shared` too: it holds rules both the SPA and the API depend on — the
    // room occupancy a rate is quoted for, for one — and an untested shared
    // rule is the one most able to break two things at once.
    include: ['src/**/*.test.{ts,tsx}', 'shared/src/**/*.test.ts'],
    // Every test starts from a clean slate for mocks and spies.
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The audited surface: services and pure functions. UI comes later.
      include: [
        'src/services/**/*.ts',
        'src/features/**/*.filters.ts',
        'src/features/**/*.links.ts',
        'src/features/**/*.context.ts',
        'src/utils/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      // Set just under what the suite currently achieves, so a regression
      // fails the run rather than quietly eroding.
      thresholds: {
        statements: 98,
        branches: 90,
        functions: 100,
        lines: 98,
      },
    },
  },
});
