import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

/**
 * The built SPA, served by the API that backs it.
 *
 * In development Vite serves the app and proxies `/api` here, which makes the
 * two same-origin — and that is not a convenience, it is what lets the refresh
 * token live in an httpOnly cookie with no CORS, no `SameSite=None`, and no
 * origin allowlist to keep in step with reality. The proxy exists only under
 * `vite dev`, so in production something has to reproduce the arrangement.
 * This is that something: one process, one origin, `/api` for the API and
 * everything else for the app.
 *
 * The alternative — the SPA on a CDN, the API on another host — means giving
 * the cookie `SameSite=None` and maintaining CORS, and then discovering which
 * browsers' tracking protection drops it anyway. Not worth it for one deploy.
 */

/** The Vite output, from `npm run build` at the repo root. */
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

/**
 * A year, and immutable.
 *
 * Only safe because Vite fingerprints these — `alaya-COowv7P3.jpg` names its
 * own contents, so a changed file is a changed URL and there is nothing to
 * revalidate. Anything unhashed must not borrow this.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Whether this process should serve the app as well as the API.
 *
 * A build has to exist — in development Vite is serving and `dist/` is
 * usually stale or absent. Test runs are excluded outright rather than left to
 * the filesystem: whether `dist/` happens to be lying around is not something
 * a test result should depend on, and one developer running `npm run build`
 * before `npm test` should not change what the suite asserts. `spaFallback` is
 * exported and tested directly instead.
 */
export function hasBuild(): boolean {
  return process.env.NODE_ENV !== 'test' && existsSync(DIST);
}

export function serveSpa(app: Express): void {
  if (!hasBuild()) return;

  app.use(
    express.static(DIST, {
      // `index.html` is fetched through the fallback below instead, so that
      // one place decides how the shell is cached.
      index: false,
      setHeaders(response, path) {
        if (path.includes(`${'/'}assets${'/'}`)) response.setHeader('Cache-Control', IMMUTABLE);
      },
    }),
  );

  app.use(spaFallback);
}

/**
 * Hands the app shell to anything that is not an API call.
 *
 * A single-page app owns its routing: `/trips/abc123` is a real address a
 * reader can bookmark, reload and share, but there is no file at that path and
 * never will be. Without this, every deep link 404s on the first load and only
 * works once you are already inside the app — the classic SPA deployment bug,
 * and one that never shows up in development because Vite already does this.
 *
 * Exported for its own tests.
 */
export function spaFallback(request: Request, response: Response, next: NextFunction): void {
  // An unknown API route is a mistake in the client, and it must arrive as the
  // JSON error envelope the client parses. Answering HTML would surface as an
  // unreadable "Unexpected token <" wherever the response was decoded.
  if (request.path.startsWith('/api/')) return next();

  // A POST to a path that does not exist is not a page request, and giving it
  // an HTML 200 would tell the caller the write succeeded.
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();

  response.sendFile('index.html', {
    root: DIST,
    headers: {
      /*
       * Never cached, unlike everything it references.
       *
       * The shell is the one unhashed file, and it is what names the current
       * hashed bundles. A cached copy pins a reader to the previous release
       * indefinitely — and once those assets are replaced, to a white screen.
       */
      'Cache-Control': 'no-cache',
    },
  });
}
