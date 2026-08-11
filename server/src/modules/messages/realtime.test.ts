import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE_CHANNEL, userChannel } from '@ai-travel/shared';
import { resetEnvCache } from '../../env';
import {
  createTokenRequest,
  isConfigured,
  publishToBoth,
  resetRealtimeClient,
} from './realtime';

/**
 * What a browser is handed, and what it may do with it.
 *
 * The capability assertions below are the most important ones in this feature.
 * They are the difference between conversations that are private at the
 * transport — one browser physically cannot listen to another person's
 * channel — and conversations that are private only because a query said so.
 */

const KEY = 'test.abcdef:0123456789abcdef0123456789abcdef';

const message = {
  id: 'dm_1',
  senderId: 'u_ada',
  recipientId: 'u_grace',
  senderName: 'Ada',
  body: 'hello',
  createdAt: '2026-08-11T10:00:00.000Z',
  clientMessageId: 'cm_1',
};

beforeEach(() => {
  process.env.ABLY_API_KEY = KEY;
  resetEnvCache();
  resetRealtimeClient();
});

afterEach(() => {
  delete process.env.ABLY_API_KEY;
  resetEnvCache();
  resetRealtimeClient();
  vi.unstubAllGlobals();
});

describe('createTokenRequest', () => {
  it('pins the token to the account asking for it', async () => {
    const request = await createTokenRequest('u_ada');

    // Ably enforces this, so nobody can enter presence as somebody else —
    // which is the whole reason the online list can be believed.
    expect(request.clientId).toBe('u_ada');
    expect(request.mac).toBeTruthy();
    expect(request.nonce).toBeTruthy();
  });

  /** The single most important assertion in the feature. */
  it('grants exactly two channels, and publishing on neither', async () => {
    const request = await createTokenRequest('u_ada');
    const capability = JSON.parse(request.capability);

    expect(Object.keys(capability).sort()).toEqual([PRESENCE_CHANNEL, 'user:u_ada'].sort());

    // Asserted as a set: the SDK normalises the operations into its own order,
    // and the order is not the property worth pinning.
    expect([...capability[PRESENCE_CHANNEL]].sort()).toEqual(['presence', 'subscribe']);
    expect([...capability['user:u_ada']].sort()).toEqual(['subscribe']);

    // With `publish` a browser could put anything on either channel under its
    // own name, and every other browser would have to re-validate what it
    // received.
    expect(capability[PRESENCE_CHANNEL]).not.toContain('publish');
    expect(capability['user:u_ada']).not.toContain('publish');
  });

  /*
   * The property that makes a private conversation private at the transport
   * rather than by convention. A token names one inbox and it is the caller's.
   */
  it('grants no access to anybody else’s inbox', async () => {
    const capability = JSON.parse((await createTokenRequest('u_ada')).capability);

    expect(capability[userChannel('u_grace')]).toBeUndefined();
    expect(Object.keys(capability)).not.toContain('user:*');
  });

  it('signs without calling anyone', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await createTokenRequest('u_ada');

    // Offline, which is what keeps the token endpoint quick on a cold instance.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('publishToBoth', () => {
  function okFetch() {
    // Typed as `fetch` so the mock's calls carry its arguments; `vi.fn(async
    // () => …)` infers a zero-argument tuple and `calls[n][0]` then does not
    // typecheck.
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    return fetchSpy;
  }

  /** The channel each call was made to, in order. */
  function channels(fetchSpy: ReturnType<typeof okFetch>): string[] {
    return fetchSpy.mock.calls.map(([url]) => decodeURIComponent(String(url)));
  }

  it('delivers to both ends of the conversation', async () => {
    const fetchSpy = okFetch();

    await publishToBoth(['u_ada', 'u_grace'], { name: 'message', data: message });

    // The sender's own inbox is not redundant: it is how their other tabs and
    // their phone learn about a message sent from this one.
    expect(channels(fetchSpy)).toHaveLength(2);
    expect(channels(fetchSpy).join(' ')).toContain('channels/user:u_ada/messages');
    expect(channels(fetchSpy).join(' ')).toContain('channels/user:u_grace/messages');
  });

  it('publishes once when both ends are the same account', async () => {
    const fetchSpy = okFetch();

    await publishToBoth(['u_ada', 'u_ada'], { name: 'message', data: message });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('says nothing when there is no key', async () => {
    delete process.env.ABLY_API_KEY;
    resetEnvCache();
    const fetchSpy = okFetch();

    await publishToBoth(['u_ada', 'u_grace'], { name: 'message', data: message });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws when the provider refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // The row is already saved and every client repairs itself on its next
    // read; answering an error would tell somebody their message failed when
    // it is safely stored.
    await expect(
      publishToBoth(['u_ada', 'u_grace'], { name: 'message', data: message }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the network is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      publishToBoth(['u_ada', 'u_grace'], { name: 'delete', data: { id: 'dm_1', senderId: 'u_ada', recipientId: 'u_grace' } }),
    ).resolves.toBeUndefined();
  });
});

describe('isConfigured', () => {
  it('is false without a key, so the app still boots', async () => {
    delete process.env.ABLY_API_KEY;
    resetEnvCache();

    expect(isConfigured()).toBe(false);
  });

  it('is true with one', () => {
    expect(isConfigured()).toBe(true);
  });
});
