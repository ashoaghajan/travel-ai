import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, LOBBY_MESSAGE_MAX_LENGTH } from '@ai-travel/shared';
import { resetEnvCache } from '../../env';
import { api, errorCode, signUp } from '../../test/harness';
import { resetAblyClient } from './ably';
import { resetLobbyRateLimit } from './lobby.routes';

/**
 * `/api/lobby` — the one room everybody shares.
 *
 * Two rules carry most of this file. An account's email must never reach a
 * room every other account can read; and sending the same message twice must
 * produce one message, because a sleeping instance takes a minute to answer
 * and the reader will press the button again long before it does.
 */

const MESSAGES = '/api/lobby/messages';
const PEOPLE = '/api/lobby/people';
const TOKEN = '/api/lobby/token';

function messageBody(overrides: Record<string, unknown> = {}) {
  return { body: 'Anyone been to Yerevan in September?', clientMessageId: 'cm_1', ...overrides };
}

/** An account with one message already in the room. */
async function withMessage(overrides: Record<string, unknown> = {}) {
  const { user, accessToken } = await signUp();
  const auth = `Bearer ${accessToken}`;

  const response = await api()
    .post(MESSAGES)
    .set('Authorization', auth)
    .send(messageBody(overrides))
    .expect(201);

  return { user, auth, message: response.body };
}

beforeEach(() => {
  resetLobbyRateLimit();
});

describe('authentication', () => {
  it.each([
    ['get', MESSAGES],
    ['post', MESSAGES],
    ['delete', `${MESSAGES}/whatever`],
    ['get', PEOPLE],
  ])('refuses %s %s with no token', async (method, path) => {
    const response = await api()[method as 'get'](path).expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('sending', () => {
  it('keeps the message and says who wrote it', async () => {
    const { user, message } = await withMessage();

    expect(message.body).toBe('Anyone been to Yerevan in September?');
    expect(message.userId).toBe(user.id);
    expect(message.authorName).toBe(user.name);
    expect(message.clientMessageId).toBe('cm_1');
    expect(Date.parse(message.createdAt)).not.toBeNaN();
  });

  it('never puts an email in a room everyone can read', async () => {
    const { auth } = await withMessage();

    const response = await api().get(MESSAGES).set('Authorization', auth).expect(200);

    // Asserted against the serialised body rather than a field, because the
    // point is that it is nowhere in the payload at all.
    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('answers a repeat of the same send with the same message', async () => {
    const { auth, message } = await withMessage();

    const again = await api()
      .post(MESSAGES)
      .set('Authorization', auth)
      .send(messageBody())
      .expect(201);

    // A cold instance takes a minute; the reader presses the button again.
    // Without this the room would show what they typed twice.
    expect(again.body.id).toBe(message.id);

    const listed = await api().get(MESSAGES).set('Authorization', auth).expect(200);
    expect(listed.body).toHaveLength(1);
  });

  it('lets two people use the same client id without colliding', async () => {
    const first = await withMessage();
    const second = await signUp({ email: 'other@example.com' });

    // The key is (userId, clientMessageId) — one browser's counter must not
    // silently swallow another person's message.
    const response = await api()
      .post(MESSAGES)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send(messageBody({ body: 'I have!' }))
      .expect(201);

    expect(response.body.id).not.toBe(first.message.id);
  });

  it.each([
    ['nothing', ''],
    ['only whitespace', '   '],
  ])('refuses a message that is %s', async (_case, body) => {
    const { accessToken } = await signUp();

    const response = await api()
      .post(MESSAGES)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(messageBody({ body }))
      .expect(422);

    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses a message past the shared cap', async () => {
    const { accessToken } = await signUp();

    await api()
      .post(MESSAGES)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(messageBody({ body: 'x'.repeat(LOBBY_MESSAGE_MAX_LENGTH + 1) }))
      .expect(422);
  });

  it('refuses a send with no client id, which is what makes a retry safe', async () => {
    const { accessToken } = await signUp();

    await api()
      .post(MESSAGES)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ body: 'no id' })
      .expect(422);
  });
});

describe('reading the room', () => {
  it('hands a newcomer the conversation oldest first', async () => {
    const { auth } = await withMessage();

    for (const [index, body] of ['second', 'third'].entries()) {
      await api()
        .post(MESSAGES)
        .set('Authorization', auth)
        .send(messageBody({ body, clientMessageId: `cm_${index + 2}` }))
        .expect(201);
    }

    const newcomer = await signUp({ email: 'newcomer@example.com' });
    const response = await api()
      .get(MESSAGES)
      .set('Authorization', `Bearer ${newcomer.accessToken}`)
      .expect(200);

    // Everyone reads the same room — this is the one endpoint here that is not
    // scoped to the caller.
    expect(response.body.map((message: { body: string }) => message.body)).toEqual([
      'Anyone been to Yerevan in September?',
      'second',
      'third',
    ]);
  });
});

describe('withdrawing a message', () => {
  it('takes it out of the room', async () => {
    const { auth, message } = await withMessage();

    await api().delete(`${MESSAGES}/${message.id}`).set('Authorization', auth).expect(204);

    const response = await api().get(MESSAGES).set('Authorization', auth).expect(200);
    expect(response.body).toHaveLength(0);
  });

  it('refuses someone else’s message, and says so', async () => {
    const { message } = await withMessage();
    const other = await signUp({ email: 'other@example.com' });

    const response = await api()
      .delete(`${MESSAGES}/${message.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);

    // A 403 rather than the 404 another account's trip gets: the message is on
    // their screen, so there is no existence to conceal.
    expect(errorCode(response)).toBe(ERROR_CODES.MESSAGE_NOT_YOURS);
  });

  it('is a 404 for a message that was never there', async () => {
    const { auth } = await withMessage();

    await api().delete(`${MESSAGES}/nope`).set('Authorization', auth).expect(404);
  });

  it('is a 404 the second time, rather than withdrawing it twice', async () => {
    const { auth, message } = await withMessage();

    await api().delete(`${MESSAGES}/${message.id}`).set('Authorization', auth).expect(204);
    await api().delete(`${MESSAGES}/${message.id}`).set('Authorization', auth).expect(404);
  });
});

describe('who is in the room', () => {
  it('names the people who have spoken, and nothing about them but that', async () => {
    const { user, auth } = await withMessage();

    const response = await api().get(PEOPLE).set('Authorization', auth).expect(200);

    expect(response.body).toEqual([{ id: user.id, name: user.name }]);
    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('does not enumerate accounts that have never posted', async () => {
    const { auth } = await withMessage();
    await signUp({ email: 'lurker@example.com' });

    // The room's bargain is that people who talk are visible to each other.
    // Listing every account that has ever registered is a larger claim.
    const response = await api().get(PEOPLE).set('Authorization', auth).expect(200);
    expect(response.body).toHaveLength(1);
  });

  it('names someone once however much they have said', async () => {
    const { auth } = await withMessage();
    await api()
      .post(MESSAGES)
      .set('Authorization', auth)
      .send(messageBody({ body: 'and another thing', clientMessageId: 'cm_2' }))
      .expect(201);

    const response = await api().get(PEOPLE).set('Authorization', auth).expect(200);
    expect(response.body).toHaveLength(1);
  });
});

describe('throttling', () => {
  // This suite is the one place the limiter is on; `setup.ts` disables it for
  // everything else, and the flag is read live so it can be switched back.
  beforeEach(() => {
    process.env.DISABLE_RATE_LIMIT = '0';
    resetLobbyRateLimit();
  });

  afterAll(() => {
    process.env.DISABLE_RATE_LIMIT = '1';
  });

  it('stops one account flooding the room', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    for (let index = 0; index < 30; index += 1) {
      await api()
        .post(MESSAGES)
        .set('Authorization', auth)
        .send(messageBody({ body: `message ${index}`, clientMessageId: `cm_${index}` }))
        .expect(201);
    }

    const response = await api()
      .post(MESSAGES)
      .set('Authorization', auth)
      .send(messageBody({ body: 'one too many', clientMessageId: 'cm_over' }))
      .expect(429);

    expect(errorCode(response)).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('throttles the account, not the address', async () => {
    const noisy = await signUp();
    const quiet = await signUp({ email: 'quiet@example.com' });

    for (let index = 0; index < 30; index += 1) {
      await api()
        .post(MESSAGES)
        .set('Authorization', `Bearer ${noisy.accessToken}`)
        .send(messageBody({ body: `message ${index}`, clientMessageId: `cm_${index}` }))
        .expect(201);
    }

    // Both requests come from the same address in this suite. Bucketing by IP
    // would silence the second person for something the first one did.
    await api()
      .post(MESSAGES)
      .set('Authorization', `Bearer ${quiet.accessToken}`)
      .send(messageBody({ body: 'hello', clientMessageId: 'cm_quiet' }))
      .expect(201);
  });
});

describe('the realtime half', () => {
  /*
   * `setup.ts` leaves `ABLY_API_KEY` unset, so the default state of this suite
   * is a server with live delivery switched off — which is also the state a
   * developer without a key is in, and it must be a working room rather than
   * a broken one.
   */

  it('will not mint a token when live messages are switched off', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .get(TOKEN)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(503);

    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  });

  it('still saves messages with no key at all', async () => {
    const { auth } = await withMessage();

    // The degradation that matters: without Ably the lobby is a room you
    // refresh, not a room that is broken.
    const response = await api().get(MESSAGES).set('Authorization', auth).expect(200);
    expect(response.body).toHaveLength(1);
  });

  it('refuses a token to a stranger', async () => {
    await api().get(TOKEN).expect(401);
  });

  describe('with a key', () => {
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

    it('signs a token for the caller and nobody else', async () => {
      const { user, accessToken } = await signUp();

      const response = await api()
        .get(TOKEN)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.clientId).toBe(user.id);
      expect(response.body.mac).toBeTruthy();
    });

    it('fans a new message out to the room', async () => {
      const published = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
      vi.stubGlobal('fetch', published);

      const { message } = await withMessage();

      const [, init] = published.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ name: 'message', data: message });
    });

    it('tells the room when a message is withdrawn', async () => {
      const { auth, message } = await withMessage();

      const published = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
      vi.stubGlobal('fetch', published);

      await api().delete(`${MESSAGES}/${message.id}`).set('Authorization', auth).expect(204);

      expect(JSON.parse(published.mock.calls[0][1].body)).toEqual({
        name: 'delete',
        data: { id: message.id },
      });
    });

    it('keeps the message when the channel will not take it', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const { accessToken } = await signUp();

      // The row is written before the publish is attempted, so a channel that
      // is down costs live delivery and nothing else. Answering 500 here would
      // tell somebody their message failed when it is safely saved.
      await api()
        .post(MESSAGES)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(messageBody())
        .expect(201);
    });
  });
});
