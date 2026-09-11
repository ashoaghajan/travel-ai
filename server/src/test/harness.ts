import request from 'supertest';
import type { Response } from 'supertest';
import type { Server } from 'node:http';
import { createApp } from '../app';
import { REFRESH_COOKIE } from '../modules/auth/cookies';

/**
 * One app, listening once, for the whole file.
 *
 * This used to be `request(createApp())`, which reads as though it mounts the
 * app in-process with no listener. It does not: handed an Express app rather
 * than a server, supertest calls `listen(0)` itself — so **every request built
 * a fresh app and bound a fresh ephemeral port**. Across the suite that is
 * some thousands of listeners opened and closed inside ninety seconds, and on
 * macOS a closed socket sits in `TIME_WAIT` for two minutes afterwards.
 *
 * What that produced was the flake nobody could pin down: a single test
 * failing per run, in a different module each time, with `ECONNRESET` or a
 * thirty-second hang on a request that does nothing. Not a logic error in any
 * of the modules it landed in — the machine had simply run out of sockets to
 * lend, and which request was unlucky was a matter of timing.
 *
 * Reusing one listener is the whole fix. A client connection per request
 * remains, which is how supertest works, but the bind-and-teardown per request
 * is gone. Building the app once is safe because nothing reads configuration
 * at construction: `env()` is called inside the handlers, which is what lets a
 * suite change the environment between two requests to the same app.
 */
let server: Server | null = null;

export const api = () => {
  server ??= createApp().listen(0);

  return request(server);
};

/**
 * Hands the port back at the end of the file.
 *
 * Called from the global `afterAll`, so no suite has to remember. A listener
 * left open would keep the worker alive and hold the port past the run.
 */
export async function closeApi(): Promise<void> {
  const closing = server;
  if (!closing) return;

  server = null;
  await new Promise<void>((resolve) => closing.close(() => resolve()));
}

export const VALID_PASSWORD = 'correct-horse-battery';

export type Credentials = {
  name?: string;
  email?: string;
  password?: string;
};

export function credentials(overrides: Credentials = {}) {
  return {
    name: overrides.name ?? 'Ada Lovelace',
    email: overrides.email ?? 'ada@example.com',
    password: overrides.password ?? VALID_PASSWORD,
  };
}

/** The refresh cookie a response set, ready to send back on the next request. */
export function refreshCookie(response: Response): string {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [header];

  const found = cookies.find((cookie) => cookie?.startsWith(`${REFRESH_COOKIE}=`));
  if (!found) throw new Error('The response set no refresh cookie.');

  // Just the name=value pair; the attributes are the browser's business.
  return found.split(';')[0];
}

/** Register an account and hand back everything a later request might need. */
export async function signUp(overrides: Credentials = {}) {
  const response = await api().post('/api/auth/register').send(credentials(overrides));

  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return {
    user: response.body.user,
    accessToken: response.body.accessToken as string,
    cookie: refreshCookie(response),
    response,
  };
}

/** The `code` from an error envelope, for readable assertions. */
export function errorCode(response: Response): unknown {
  return response.body?.error?.code;
}

/**
 * Makes two accounts friends, straight in the database.
 *
 * Messaging is friends-only, so almost every conversation test needs this
 * before it can say anything at all. Written directly rather than through
 * `POST /api/friends/:id` twice, so that a messages test failing tells you
 * something about messages: routed through the API, a broken friends endpoint
 * would fail thirty tests in three other files and name none of them.
 */
export async function befriend(a: string, b: string): Promise<void> {
  const { prisma } = await import('../prisma');
  const { pairKeyOf } = await import('../modules/messages/messages.service');

  await prisma.friendship.create({
    data: {
      pairKey: pairKeyOf(a, b),
      requesterId: a,
      addresseeId: b,
      status: 'accepted',
      respondedAt: new Date(),
    },
  });
}
