import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../app';
import { REFRESH_COOKIE } from '../modules/auth/cookies';

/** The app, mounted in-process — no port, no listener, no teardown. */
export const api = () => request(createApp());

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
