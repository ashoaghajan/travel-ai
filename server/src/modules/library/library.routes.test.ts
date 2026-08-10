import { describe, expect, it } from 'vitest';
import { api, signUp } from '../../test/harness';

/**
 * Saved attractions, recent searches and the planner conversation.
 *
 * All three are shortlists rather than archives, and the property worth
 * testing hardest is the one that could not hold before: the caps are enforced
 * here. They used to be client-side, which meant a second device grew straight
 * past them — and a shortlist that quietly becomes a thousand rows stops being
 * a shortlist.
 */

const SAVED = '/api/saved-activities';
const SEARCHES = '/api/searches/flights';
const CHAT = '/api/conversations/current';

function activity(id: string, title = `Place ${id}`) {
  return {
    id,
    title,
    category: 'culture',
    description: 'Museums · 1.2 km from centre',
    price: 0,
    rating: 5,
    reviews: 0,
    image: 'city.jpg',
  };
}

function flightQuery(overrides: Record<string, unknown> = {}) {
  return {
    tripType: 'round-trip',
    from: 'EVN',
    to: 'DXB',
    departDate: '2027-09-11',
    returnDate: '2027-09-18',
    travellers: 2,
    ...overrides,
  };
}

async function account() {
  const { accessToken } = await signUp();

  return `Bearer ${accessToken}`;
}

describe('authentication', () => {
  it('refuses each surface with no token', async () => {
    await api().get(SAVED).expect(401);
    await api().get(SEARCHES).expect(401);
    await api().get(CHAT).expect(401);
  });
});

describe('saved activities', () => {
  it('starts empty', async () => {
    const auth = await account();

    await expect(api().get(SAVED).set('Authorization', auth).expect(200)).resolves.toMatchObject({
      body: [],
    });
  });

  it('saves an attraction and answers with the shortlist', async () => {
    const auth = await account();

    const response = await api()
      .put(`${SAVED}/otm_cascade`)
      .set('Authorization', auth)
      .send({ activity: activity('otm_cascade') })
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].activity).toMatchObject({ id: 'otm_cascade' });
  });

  it('moves a re-saved attraction to the top rather than duplicating it', async () => {
    const auth = await account();

    await api().put(`${SAVED}/a`).set('Authorization', auth).send({ activity: activity('a') });
    await api().put(`${SAVED}/b`).set('Authorization', auth).send({ activity: activity('b') });

    const response = await api()
      .put(`${SAVED}/a`)
      .set('Authorization', auth)
      .send({ activity: activity('a', 'Renamed') })
      .expect(200);

    // Re-saving is what the reader means by tapping the heart again on
    // something already saved; a second copy is not.
    expect(response.body).toHaveLength(2);
    expect(response.body[0].activity).toMatchObject({ id: 'a', title: 'Renamed' });
  });

  it('removes one, idempotently', async () => {
    const auth = await account();
    await api().put(`${SAVED}/a`).set('Authorization', auth).send({ activity: activity('a') });

    await api().delete(`${SAVED}/a`).set('Authorization', auth).expect(200);
    const response = await api().delete(`${SAVED}/a`).set('Authorization', auth).expect(200);

    expect(response.body).toEqual([]);
  });

  it('empties the shortlist', async () => {
    const auth = await account();
    await api().put(`${SAVED}/a`).set('Authorization', auth).send({ activity: activity('a') });

    await api().delete(SAVED).set('Authorization', auth).expect(204);

    const response = await api().get(SAVED).set('Authorization', auth).expect(200);
    expect(response.body).toEqual([]);
  });

  it('keeps one account’s shortlist out of another', async () => {
    const mine = await account();
    await api().put(`${SAVED}/a`).set('Authorization', mine).send({ activity: activity('a') });

    const theirs = await signUp({ email: 'other@example.com' });
    const response = await api()
      .get(SAVED)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('refuses an attraction with no title', async () => {
    const auth = await account();

    await api()
      .put(`${SAVED}/a`)
      .set('Authorization', auth)
      .send({ activity: { ...activity('a'), title: '  ' } })
      .expect(422);
  });
});

describe('recent searches', () => {
  it('records a search and answers with the list', async () => {
    const auth = await account();

    const response = await api()
      .post(SEARCHES)
      .set('Authorization', auth)
      .send({ query: flightQuery() })
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ from: 'EVN', to: 'DXB' });
  });

  it('treats the same search run twice as one', async () => {
    const auth = await account();

    await api().post(SEARCHES).set('Authorization', auth).send({ query: flightQuery() });
    const response = await api()
      .post(SEARCHES)
      .set('Authorization', auth)
      .send({ query: flightQuery() })
      .expect(200);

    // Otherwise running a search twice fills the whole shortlist with one
    // entry and pushes out the four that were useful.
    expect(response.body).toHaveLength(1);
  });

  it('caps the list at five', async () => {
    const auth = await account();

    for (let index = 0; index < 8; index += 1) {
      await api()
        .post(SEARCHES)
        .set('Authorization', auth)
        .send({ query: flightQuery({ departDate: `2027-09-0${index + 1}` }) });
    }

    const response = await api().get(SEARCHES).set('Authorization', auth).expect(200);

    // Enforced here rather than only on the client, where a second device
    // would have grown straight past it.
    expect(response.body).toHaveLength(5);
  });

  it('keeps the most recent, not the first five', async () => {
    const auth = await account();

    for (let index = 0; index < 7; index += 1) {
      await api()
        .post(SEARCHES)
        .set('Authorization', auth)
        .send({ query: flightQuery({ departDate: `2027-09-0${index + 1}` }) });
    }

    const response = await api().get(SEARCHES).set('Authorization', auth).expect(200);
    expect(response.body[0].departDate).toBe('2027-09-07');
  });

  it('empties the list', async () => {
    const auth = await account();
    await api().post(SEARCHES).set('Authorization', auth).send({ query: flightQuery() });

    await api().delete('/api/searches').set('Authorization', auth).expect(204);

    const response = await api().get(SEARCHES).set('Authorization', auth).expect(200);
    expect(response.body).toEqual([]);
  });
});

describe('the planner conversation', () => {
  const messages = [
    { id: 'm1', author: 'user', text: 'Plan me a week in Yerevan' },
    { id: 'm2', author: 'ai', text: 'Here is a plan.' },
  ];

  it('is empty for an account that has never opened the planner', async () => {
    const auth = await account();

    const response = await api().get(CHAT).set('Authorization', auth).expect(200);

    // No row rather than a missing one — an empty conversation, not an error.
    expect(response.body).toEqual({ messages: [] });
  });

  it('records the conversation and reads it back', async () => {
    const auth = await account();

    await api().put(CHAT).set('Authorization', auth).send({ messages }).expect(204);

    const response = await api().get(CHAT).set('Authorization', auth).expect(200);
    expect(response.body.messages).toHaveLength(2);
  });

  it('replaces rather than appends', async () => {
    const auth = await account();
    await api().put(CHAT).set('Authorization', auth).send({ messages });

    await api()
      .put(CHAT)
      .set('Authorization', auth)
      .send({ messages: [messages[0]] })
      .expect(204);

    // A turn can edit the message before it — an AI reply gaining its trip
    // draft once generation finishes — so appending would leave the stored
    // copy behind the one on screen.
    const response = await api().get(CHAT).set('Authorization', auth).expect(200);
    expect(response.body.messages).toHaveLength(1);
  });

  it('keeps whatever a message carries besides its text', async () => {
    const auth = await account();

    await api()
      .put(CHAT)
      .set('Authorization', auth)
      .send({ messages: [{ ...messages[1], tripDraft: { title: 'Yerevan' } }] })
      .expect(204);

    // An AI turn carries a whole `TripDraft`; re-describing that in the schema
    // would be a second copy of the trip shape kept in step by hand.
    const response = await api().get(CHAT).set('Authorization', auth).expect(200);
    expect(response.body.messages[0].tripDraft).toEqual({ title: 'Yerevan' });
  });

  it('clears the conversation', async () => {
    const auth = await account();
    await api().put(CHAT).set('Authorization', auth).send({ messages });

    await api().delete(CHAT).set('Authorization', auth).expect(204);

    const response = await api().get(CHAT).set('Authorization', auth).expect(200);
    expect(response.body).toEqual({ messages: [] });
  });

  it('keeps one account’s conversation out of another', async () => {
    const mine = await account();
    await api().put(CHAT).set('Authorization', mine).send({ messages });

    const theirs = await signUp({ email: 'other@example.com' });
    const response = await api()
      .get(CHAT)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({ messages: [] });
  });
});
