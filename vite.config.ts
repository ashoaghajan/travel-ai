import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const shared = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function offlineServiceWorker(): Plugin {
  return {
    name: 'ai-travel-offline-service-worker',
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .filter((item) => item.type === 'asset' || item.type === 'chunk')
        .map((item) => `/${item.fileName}`)
        .filter((path) => /\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/i.test(path));
      const precache = [...new Set(['/index.html', '/favicon.svg', '/icons.svg', ...assets])];

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
const CACHE_NAME = 'ai-travel-shell-v1';
const PRECACHE_URLS = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ai-travel-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
        }
        return response;
      }).catch(async () => (await caches.match('/index.html')) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg' || url.pathname === '/icons.svg') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
`,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
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
      /*
       * `127.0.0.1`, not `localhost`.
       *
       * macOS resolves `localhost` to `::1` before `127.0.0.1`, so the proxy
       * followed whatever held the IPv6 loopback on this port — which, the day
       * another project's dev server was running, was that project. Every
       * `/api` call reached it instead: GETs came back as its `index.html` and
       * POSTs as a bare 404, which reads like the API losing its routes rather
       * than like a neighbour answering the door.
       *
       * The API binds every interface, so naming the IPv4 loopback costs
       * nothing and removes the ambiguity.
       */
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
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
