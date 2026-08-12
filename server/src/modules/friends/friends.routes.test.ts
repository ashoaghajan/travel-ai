import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { api, errorCode, signUp } from '../../test/harness';

/**
 * `/api/friends` — who may talk to whom.
 *
 * Two rules carry most of this file. A connection needs both ends to have
 * agreed, so nobody can add anybody unilaterally; and every state is written
 * from the reader's side, so "you asked" and "they asked" are never the same
 * answer.
 */

const FRIENDS = '/api/friends';

async function three() {
  const alice = await signUp({ email: 'alice@example.com', name: 'Alice' });
  const bob = await signUp({ email: 'bob@example.com', name: 'Bob' });
  const carol = await signUp({ email: 'carol@example.com', name: 'Carol' });

  return {
    alice: { id: alice.user.id, auth: `Bearer ${alice.accessToken}` },
    bob: { id: bob.user.id, auth: `Bearer ${bob.accessToken}` },
    carol: { id: carol.user.id, auth: `Bearer ${carol.accessToken}` },
  };
}

type Account = { id: string; auth: string };

const ask = (from: Account, to: Account) =>
  api().post(`${FRIENDS}/${to.id}`).set('Authorization', from.auth);

const accept = (who: Account, other: Account) =>
  api().post(`${FRIENDS}/${other.id}/accept`).set('Authorization', who.auth);

const remove = (who: Account, other: Account) =>
  api().delete(`${FRIENDS}/${other.id}`).set('Authorization', who.auth);

/** Alice and Bob, connected the ordinary way. */
async function friends() {
  const people = await three();

  await ask(people.alice, people.bob).expect(201);
  await accept(people.bob, people.alice).expect(200);

  return people;
}

describe('authentication', () => {
  it.each([
    ['get', FRIENDS],
    ['get', `${FRIENDS}/requests`],
    ['get', `${FRIENDS}/stats`],
    ['get', `${FRIENDS}/search`],
    ['post', `${FRIENDS}/u_1`],
    ['post', `${FRIENDS}/u_1/accept`],
    ['delete', `${FRIENDS}/u_1`],
  ])('refuses %s %s with no token', async (method, path) => {
    const response = await api()[method as 'get'](path).expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('asking', () => {
  it('is one-sided until the other person answers', async () => {
    const { alice, bob } = await three();

    const asked = await ask(alice, bob).expect(201);
    expect(asked.body.status).toBe('outgoing');

    // Nothing is a friendship yet, on either side.
    expect((await api().get(FRIENDS).set('Authorization', alice.auth).expect(200)).body).toEqual([]);
    expect((await api().get(FRIENDS).set('Authorization', bob.auth).expect(200)).body).toEqual([]);
  });

  it('reads as outgoing to one of them and incoming to the other', async () => {
    const { alice, bob } = await three();
    await ask(alice, bob).expect(201);

    const forAlice = await api()
      .get(`${FRIENDS}/requests`)
      .set('Authorization', alice.auth)
      .expect(200);
    const forBob = await api().get(`${FRIENDS}/requests`).set('Authorization', bob.auth).expect(200);

    expect(forAlice.body.outgoing.map((r: { id: string }) => r.id)).toEqual([bob.id]);
    expect(forAlice.body.incoming).toEqual([]);
    expect(forBob.body.incoming.map((r: { id: string }) => r.id)).toEqual([alice.id]);
    expect(forBob.body.outgoing).toEqual([]);
  });

  it('asks once however many times the button is pressed', async () => {
    const { alice, bob } = await three();

    await ask(alice, bob).expect(201);
    const second = await ask(alice, bob).expect(201);

    expect(second.body.status).toBe('outgoing');
    const requests = await api()
      .get(`${FRIENDS}/requests`)
      .set('Authorization', bob.auth)
      .expect(200);
    expect(requests.body.incoming).toHaveLength(1);
  });

  it('takes asking somebody who already asked you as agreement', async () => {
    const { alice, bob } = await three();
    await ask(alice, bob).expect(201);

    // Two people who have each pressed Add have plainly agreed; making one of
    // them go and find the other's request would be pedantry.
    const response = await ask(bob, alice).expect(201);

    expect(response.body.status).toBe('friends');
    expect((await api().get(FRIENDS).set('Authorization', alice.auth).expect(200)).body).toHaveLength(
      1,
    );
  });

  it('refuses to befriend yourself, or a stranger who does not exist', async () => {
    const { alice } = await three();

    await api().post(`${FRIENDS}/${alice.id}`).set('Authorization', alice.auth).expect(422);
    await api().post(`${FRIENDS}/u_nobody`).set('Authorization', alice.auth).expect(404);
  });
});

describe('accepting', () => {
  it('connects them both ways', async () => {
    const { alice, bob } = await friends();

    const forAlice = await api().get(FRIENDS).set('Authorization', alice.auth).expect(200);
    const forBob = await api().get(FRIENDS).set('Authorization', bob.auth).expect(200);

    expect(forAlice.body.map((f: { id: string }) => f.id)).toEqual([bob.id]);
    expect(forBob.body.map((f: { id: string }) => f.id)).toEqual([alice.id]);
    expect(forAlice.body[0].since).toEqual(expect.any(String));
  });

  it('empties the requests list for both of them', async () => {
    const { alice, bob } = await friends();

    for (const account of [alice, bob]) {
      const requests = await api()
        .get(`${FRIENDS}/requests`)
        .set('Authorization', account.auth)
        .expect(200);

      expect(requests.body).toEqual({ incoming: [], outgoing: [] });
    }
  });

  it('is not the asker’s to accept', async () => {
    const { alice, bob } = await three();
    await ask(alice, bob).expect(201);

    // The whole point of the feature: nobody adds anybody unilaterally.
    const response = await accept(alice, bob).expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.FRIEND_REQUEST_NOT_FOUND);
  });

  it('says friends when they already are', async () => {
    const { alice, bob } = await friends();

    const response = await accept(bob, alice).expect(200);

    // Already connected is not a failure; it is the state they asked for.
    expect(response.body.status).toBe('friends');
  });

  it('refuses a request nobody made', async () => {
    const { alice, carol } = await three();

    await accept(alice, carol).expect(404);
  });
});

describe('cancelling, declining and unfriending', () => {
  it('lets the asker take it back', async () => {
    const { alice, bob } = await three();
    await ask(alice, bob).expect(201);

    await remove(alice, bob).expect(204);

    const requests = await api()
      .get(`${FRIENDS}/requests`)
      .set('Authorization', bob.auth)
      .expect(200);
    expect(requests.body.incoming).toEqual([]);
  });

  it('lets the asked decline, leaving no trace', async () => {
    const { alice, bob } = await three();
    await ask(alice, bob).expect(201);

    await remove(bob, alice).expect(204);

    // Nothing on either side records that it happened, which is deliberate —
    // and it means they may ask again.
    const forAlice = await api()
      .get(`${FRIENDS}/requests`)
      .set('Authorization', alice.auth)
      .expect(200);
    expect(forAlice.body.outgoing).toEqual([]);

    await ask(alice, bob).expect(201);
  });

  it('lets either friend end it', async () => {
    const { alice, bob } = await friends();

    await remove(bob, alice).expect(204);

    expect((await api().get(FRIENDS).set('Authorization', alice.auth).expect(200)).body).toEqual([]);
    expect((await api().get(FRIENDS).set('Authorization', bob.auth).expect(200)).body).toEqual([]);
  });

  it('is agreement rather than an error when there is nothing to remove', async () => {
    const { alice, carol } = await three();

    await remove(alice, carol).expect(204);
  });

  it('leaves the messages where they are', async () => {
    const { alice, bob } = await friends();
    await api()
      .post(`/api/messages/with/${bob.id}`)
      .set('Authorization', alice.auth)
      .send({ body: 'hello', clientMessageId: 'cm_1' })
      .expect(201);

    await remove(alice, bob).expect(204);
    await ask(alice, bob).expect(201);
    await accept(bob, alice).expect(200);

    // Nothing was destroyed: re-friending brings the conversation back whole.
    const thread = await api()
      .get(`/api/messages/with/${bob.id}`)
      .set('Authorization', alice.auth)
      .expect(200);
    expect(thread.body).toHaveLength(1);
  });
});

describe('finding somebody', () => {
  it('lists every account but the reader, with where they stand', async () => {
    const { alice, bob, carol } = await three();
    await ask(alice, bob).expect(201);

    const response = await api()
      .get(`${FRIENDS}/search`)
      .set('Authorization', alice.auth)
      .expect(200);

    expect(response.body).toHaveLength(2);
    const byId = new Map(response.body.map((p: { id: string; status: string }) => [p.id, p.status]));
    expect(byId.get(bob.id)).toBe('outgoing');
    expect(byId.get(carol.id)).toBe('none');
  });

  it('says incoming to the person who was asked', async () => {
    const { alice, bob } = await three();
    await ask(alice, bob).expect(201);

    const response = await api()
      .get(`${FRIENDS}/search`)
      .set('Authorization', bob.auth)
      .expect(200);

    expect(response.body.find((p: { id: string }) => p.id === alice.id).status).toBe('incoming');
  });

  it('narrows by name', async () => {
    const { alice } = await three();

    const response = await api()
      .get(`${FRIENDS}/search`)
      .query({ q: 'car' })
      .set('Authorization', alice.auth)
      .expect(200);

    expect(response.body.map((p: { name: string }) => p.name)).toEqual(['Carol']);
  });

  it('never puts an email in the list', async () => {
    const { alice } = await three();

    const response = await api()
      .get(`${FRIENDS}/search`)
      .set('Authorization', alice.auth)
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('@');
  });
});

describe('the counts on a profile', () => {
  it('counts friends, both kinds of request, and the whole app', async () => {
    const { alice, bob, carol } = await friends();
    await ask(carol, alice).expect(201);

    const response = await api().get(`${FRIENDS}/stats`).set('Authorization', alice.auth).expect(200);

    expect(response.body).toEqual({ friends: 1, incoming: 1, outgoing: 0, totalUsers: 3 });
    expect(bob.id).toBeTruthy();
  });

  it('starts at nothing for a new account', async () => {
    const { carol } = await three();

    const response = await api().get(`${FRIENDS}/stats`).set('Authorization', carol.auth).expect(200);

    expect(response.body).toMatchObject({ friends: 0, incoming: 0, outgoing: 0 });
    // A fact about the app rather than about a person, which is why it can be
    // shown to everybody: it names nobody.
    expect(response.body.totalUsers).toBe(3);
  });
});
