import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOBBY_CHANNEL } from '@ai-travel/shared';
import { resetEnvCache } from '../../env';
import { createTokenRequest, isConfigured, publishMessage, resetAblyClient } from './ably';

/**
 * What the browser is handed, and what it may do with it.
 *
 * The capability assertion below is the most important one in this feature. It
 * is the difference between a room where every message was validated and
 * written down before anyone saw it, and one where any client can put whatever
 * it likes on the channel under its own name.
 */

const KEY = 'test.abcdef:0123456789abcdef0123456789abcdef';

beforeEach(() => {
  process.env.ABLY_API_KEY = KEY;
  resetEnvCache();
  resetAblyClient();
});

afterEach(() => {
  delete process.env.ABLY_API_KEY;
  resetEnvCache();
  resetAblyClient();
  vi.unstubAllGlobals();
});

describe('createTokenRequest', () => {
  it('pins the token to the account asking for it', async () => {
    const request = await createTokenRequest('u_ada');

    // Ably enforces this, so nobody can join the room as somebody else — which
    // is the whole reason the presence list can be believed.
    expect(request.clientId).toBe('u_ada');
    expect(request.mac).toBeTruthy();
    expect(request.nonce).toBeTruthy();
  });

  it('grants listening and presence, and refuses publishing', async () => {
    const request = await createTokenRequest('u_ada');
    const capability = JSON.parse(request.capability);

    // Asserted as a set: the SDK normalises the operations into its own order,
    // and the order is not the property worth pinning.
    expect(Object.keys(capability)).toEqual([LOBBY_CHANNEL]);
    expect([...capability[LOBBY_CHANNEL]].sort()).toEqual(['presence', 'subscribe']);

    // The line this whole design rests on. With `publish` a browser could put
    // anything on the channel under its own name, and every other browser
    // would have to re-validate what it received.
    expect(capability[LOBBY_CHANNEL]).not.toContain('publish');
  });

  it('signs without calling anyone', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await createTokenRequest('u_ada');

    // Offline by construction, which is what keeps this endpoint quick on an
    // instance that has just woken up.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to invent a token with no key', async () => {
    delete process.env.ABLY_API_KEY;
    resetEnvCache();
    resetAblyClient();

    await expect(createTokenRequest('u_ada')).rejects.toThrow(/ABLY_API_KEY/);
  });
});

describe('isConfigured', () => {
  it('is false without a key', () => {
    delete process.env.ABLY_API_KEY;
    resetEnvCache();

    expect(isConfigured()).toBe(false);
  });

  it('is true with one', () => {
    expect(isConfigured()).toBe(true);
  });
});

describe('publishMessage', () => {
  it('posts the event to the room’s channel', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    await publishMessage({ name: 'delete', data: { id: 'lm_1' } });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `https://rest.ably.io/channels/${encodeURIComponent(LOBBY_CHANNEL)}/messages`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from(KEY).toString('base64')}`);
    expect(JSON.parse(init.body)).toEqual({ name: 'delete', data: { id: 'lm_1' } });
  });

  it('does nothing at all without a key', async () => {
    delete process.env.ABLY_API_KEY;
    resetEnvCache();

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await publishMessage({ name: 'delete', data: { id: 'lm_1' } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a refusal', async () => new Response('nope', { status: 401 })],
    ['a dead network', async () => Promise.reject(new Error('offline'))],
  ])('swallows %s rather than failing the send', async (_case, answer) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(answer));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // The message is already saved by the time this runs. Telling somebody
    // their message failed when it is safely written down would be a lie.
    await expect(publishMessage({ name: 'delete', data: { id: 'lm_1' } })).resolves.toBeUndefined();
  });
});
