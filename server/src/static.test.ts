import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { spaFallback } from './static';
import { api } from './test/harness';

/**
 * Who answers what, once one process serves both the app and the API.
 *
 * `spaFallback` is exercised directly rather than through `createApp`, because
 * the real app deliberately refuses to serve the build under test — see
 * `hasBuild`. Mounting it here keeps these assertions independent of whether
 * anyone happened to run `npm run build` first.
 */

/** The fallback alone, with a stand-in API route in front of it. */
function app() {
  const instance = express();

  instance.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  instance.use(spaFallback);
  // What `notFoundHandler` stands for: anything the fallback passes along.
  instance.use((_request, response) => response.status(404).json({ error: 'not found' }));

  return request(instance);
}

describe('spaFallback', () => {
  it('gives the app shell to a deep link that is not a file', async () => {
    // The classic SPA deployment bug: `/trips/abc123` is a real address that a
    // reader can bookmark and reload, and there is no file at that path.
    const response = await app().get('/trips/abc123');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('never caches the shell', async () => {
    // It is the one unhashed file, and it names the current hashed bundles. A
    // cached copy pins the reader to the last release, then to a white screen.
    const response = await app().get('/trips/abc123');

    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('leaves an unknown API route to answer as JSON', async () => {
    // HTML here would surface in the client as "Unexpected token <" wherever
    // the response was parsed, rather than as the error envelope.
    const response = await app().get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('does not shadow a real API route', async () => {
    await expect(app().get('/api/health').expect(200)).resolves.toMatchObject({
      body: { status: 'ok' },
    });
  });

  it('refuses to answer a write to a path that does not exist', async () => {
    // An HTML 200 would tell the caller their POST succeeded.
    const response = await app().post('/trips/abc123');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('the app under test', () => {
  it('still answers an unknown route as JSON, build present or not', async () => {
    // `hasBuild()` is false under test on purpose, so the suite asserts the
    // same thing on a machine that has run `npm run build` and one that hasn't.
    const response = await api().get('/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
