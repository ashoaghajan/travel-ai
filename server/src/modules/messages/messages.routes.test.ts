import { beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, MESSAGE_MAX_LENGTH } from '@ai-travel/shared';
import { api, errorCode, signUp } from '../../test/harness';
import { resetMessagesRateLimit } from './messages.routes';

/**
 * `/api/messages` — private conversations, two people at a time.
 *
 * Three rules carry most of this file. A message is readable by exactly two
 * accounts and no others; an email never reaches a screen another account can
 * read; and sending the same message twice produces one message, because a
 * sleeping instance takes a minute to answer and the reader will press the
 * button again long before it does.
 */

const CONVERSATIONS = '/api/messages/conversations';
const withUser = (id: string) => `/api/messages/with/${id}`;

function messageBody(overrides: Record<string, unknown> = {}) {
  return { body: 'Anyone been to Yerevan in September?', clientMessageId: 'cm_1', ...overrides };
}

/** Two accounts, with helpers for talking as either. */
async function pair() {
  const alice = await signUp({ email: 'alice@example.com', name: 'Alice' });
  const bob = await signUp({ email: 'bob@example.com', name: 'Bob' });

  return {
    alice: { user: alice.user, auth: `Bearer ${alice.accessToken}` },
    bob: { user: bob.user, auth: `Bearer ${bob.accessToken}` },
  };
}

beforeEach(() => {
  resetMessagesRateLimit();
});

describe('authentication', () => {
  it.each([
    ['get', CONVERSATIONS],
    ['get', '/api/messages/with/u_1'],
    ['post', '/api/messages/with/u_1'],
    ['post', '/api/messages/with/u_1/read'],
    ['delete', '/api/messages/lm_1'],
  ])('refuses %s %s with no token', async (method, path) => {
    const response = await api()[method as 'get'](path).expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('sending', () => {
  it('keeps the message and says who wrote it', async () => {
    const { alice, bob } = await pair();

    const response = await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(201);

    expect(response.body.body).toBe('Anyone been to Yerevan in September?');
    expect(response.body.senderId).toBe(alice.user.id);
    expect(response.body.recipientId).toBe(bob.user.id);
    expect(response.body.senderName).toBe('Alice');
  });

  it('returns the same message when the same send is retried', async () => {
    const { alice, bob } = await pair();

    const first = await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(201);

    const second = await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(201);

    // The retry story. A cold instance takes about a minute to answer, and the
    // reader presses the button again long before it does.
    expect(second.body.id).toBe(first.body.id);
  });

  it('refuses a message to yourself', async () => {
    const { alice } = await pair();

    await api()
      .post(withUser(alice.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(422);
  });

  it('refuses a message to somebody who does not exist', async () => {
    const { alice } = await pair();

    await api()
      .post(withUser('u_nobody'))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(404);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n  '],
    ['too long', 'x'.repeat(MESSAGE_MAX_LENGTH + 1)],
  ])('refuses a body that is %s', async (_label, body) => {
    const { alice, bob } = await pair();

    await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody({ body }))
      .expect(422);
  });
});

describe('reading a thread', () => {
  it('is the same conversation whichever end asks', async () => {
    const { alice, bob } = await pair();
    await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody({ body: 'hello' }))
      .expect(201);

    const asBob = await api()
      .get(withUser(alice.user.id))
      .set('Authorization', bob.auth)
      .expect(200);

    // A conversation is an unordered pair — see `pairKeyOf`.
    expect(asBob.body.map((m: { body: string }) => m.body)).toEqual(['hello']);
  });

  it('is oldest first, however it was written', async () => {
    const { alice, bob } = await pair();

    for (const [index, body] of ['first', 'second', 'third'].entries()) {
      await api()
        .post(withUser(bob.user.id))
        .set('Authorization', alice.auth)
        .send(messageBody({ body, clientMessageId: `cm_${index}` }))
        .expect(201);
    }

    const response = await api()
      .get(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .expect(200);

    expect(response.body.map((m: { body: string }) => m.body)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  /*
   * The rule the whole feature rests on. The lobby could be read by everybody
   * by design; this cannot, and a third account must see nothing of it.
   */
  it('shows nothing of a conversation between two other people', async () => {
    const { alice, bob } = await pair();
    const carol = await signUp({ email: 'carol@example.com', name: 'Carol' });
    const carolAuth = `Bearer ${carol.accessToken}`;

    await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody({ body: 'between us' }))
      .expect(201);

    const asCarol = await api()
      .get(withUser(alice.user.id))
      .set('Authorization', carolAuth)
      .expect(200);

    expect(asCarol.body).toEqual([]);
  });

  it('leaves a withdrawn message out', async () => {
    const { alice, bob } = await pair();
    const sent = await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(201);

    await api()
      .delete(`/api/messages/${sent.body.id}`)
      .set('Authorization', alice.auth)
      .expect(204);

    const response = await api()
      .get(withUser(alice.user.id))
      .set('Authorization', bob.auth)
      .expect(200);

    expect(response.body).toEqual([]);
  });
});

describe('withdrawing', () => {
  it('refuses to withdraw somebody else’s message', async () => {
    const { alice, bob } = await pair();
    const sent = await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(201);

    const response = await api()
      .delete(`/api/messages/${sent.body.id}`)
      .set('Authorization', bob.auth)
      .expect(403);

    // A 403 rather than a 404: there is no existence to conceal from the one
    // person who is looking at it.
    expect(errorCode(response)).toBe(ERROR_CODES.MESSAGE_NOT_YOURS);
  });

  it('is a 404 the second time, rather than withdrawing it twice', async () => {
    const { alice, bob } = await pair();
    const sent = await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody())
      .expect(201);

    await api().delete(`/api/messages/${sent.body.id}`).set('Authorization', alice.auth).expect(204);
    await api().delete(`/api/messages/${sent.body.id}`).set('Authorization', alice.auth).expect(404);
  });
});

describe('the conversation list', () => {
  it('names every account but your own', async () => {
    const { alice, bob } = await pair();

    const response = await api().get(CONVERSATIONS).set('Authorization', alice.auth).expect(200);

    // Deliberately broader than the lobby's roster, which listed only people
    // who had posted: you cannot message somebody you cannot find.
    expect(response.body.map((c: { id: string }) => c.id)).toEqual([bob.user.id]);
  });

  it('says nothing about anybody but their name', async () => {
    const { alice } = await pair();

    const response = await api().get(CONVERSATIONS).set('Authorization', alice.auth).expect(200);

    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('lists somebody you have never written to, with no last message', async () => {
    const { alice, bob } = await pair();

    const response = await api().get(CONVERSATIONS).set('Authorization', alice.auth).expect(200);

    expect(response.body[0]).toMatchObject({ id: bob.user.id, lastMessage: null, unread: 0 });
  });

  it('previews the newest message, and says whose it is', async () => {
    const { alice, bob } = await pair();
    await api()
      .post(withUser(bob.user.id))
      .set('Authorization', alice.auth)
      .send(messageBody({ body: 'older', clientMessageId: 'cm_a' }))
      .expect(201);
    await api()
      .post(withUser(alice.user.id))
      .set('Authorization', bob.auth)
      .send(messageBody({ body: 'newer', clientMessageId: 'cm_b' }))
      .expect(201);

    const response = await api().get(CONVERSATIONS).set('Authorization', alice.auth).expect(200);

    expect(response.body[0].lastMessage).toMatchObject({ body: 'newer', isMine: false });
  });

  it('finds one person by name', async () => {
    const { alice, bob } = await pair();

    const response = await api()
      .get(CONVERSATIONS)
      .query({ q: 'bo' })
      .set('Authorization', alice.auth)
      .expect(200);

    expect(response.body.map((c: { id: string }) => c.id)).toEqual([bob.user.id]);
  });
});

describe('unread', () => {
  async function sendTo(from: { auth: string }, toId: string, body: string, id: string) {
    await api()
      .post(withUser(toId))
      .set('Authorization', from.auth)
      .send(messageBody({ body, clientMessageId: id }))
      .expect(201);
  }

  it('counts what the other person said and you have not read', async () => {
    const { alice, bob } = await pair();
    await sendTo(alice, bob.user.id, 'one', 'cm_1');
    await sendTo(alice, bob.user.id, 'two', 'cm_2');

    const response = await api().get(CONVERSATIONS).set('Authorization', bob.auth).expect(200);

    expect(response.body[0].unread).toBe(2);
  });

  it('never counts your own', async () => {
    const { alice, bob } = await pair();
    await sendTo(alice, bob.user.id, 'one', 'cm_1');

    const response = await api().get(CONVERSATIONS).set('Authorization', alice.auth).expect(200);

    expect(response.body[0].unread).toBe(0);
  });

  it('clears when the thread is marked read', async () => {
    const { alice, bob } = await pair();
    await sendTo(alice, bob.user.id, 'one', 'cm_1');

    await api()
      .post(`${withUser(alice.user.id)}/read`)
      .set('Authorization', bob.auth)
      .expect(204);

    const response = await api().get(CONVERSATIONS).set('Authorization', bob.auth).expect(200);

    // A cursor rather than per-tab state, so it survives a reload.
    expect(response.body[0].unread).toBe(0);
  });

  it('counts again for what arrives after it was read', async () => {
    const { alice, bob } = await pair();
    await sendTo(alice, bob.user.id, 'one', 'cm_1');
    await api().post(`${withUser(alice.user.id)}/read`).set('Authorization', bob.auth).expect(204);

    await sendTo(alice, bob.user.id, 'two', 'cm_2');

    const response = await api().get(CONVERSATIONS).set('Authorization', bob.auth).expect(200);
    expect(response.body[0].unread).toBe(1);
  });

  it('counts each conversation separately', async () => {
    const { alice, bob } = await pair();
    const carol = await signUp({ email: 'carol@example.com', name: 'Carol' });
    const carolAuth = `Bearer ${carol.accessToken}`;

    await sendTo(alice, bob.user.id, 'from alice', 'cm_1');
    await sendTo({ auth: carolAuth }, bob.user.id, 'from carol', 'cm_2');
    await api().post(`${withUser(alice.user.id)}/read`).set('Authorization', bob.auth).expect(204);

    const response = await api().get(CONVERSATIONS).set('Authorization', bob.auth).expect(200);
    const byId = new Map(response.body.map((c: { id: string; unread: number }) => [c.id, c.unread]));

    // Reading Alice must not silence Carol.
    expect(byId.get(alice.user.id)).toBe(0);
    expect(byId.get(carol.user.id)).toBe(1);
  });
});
