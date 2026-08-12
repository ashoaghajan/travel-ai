import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { api, errorCode, signUp } from '../../test/harness';

/**
 * Sharing a trip through a conversation.
 *
 * The offer is a snapshot and the copy is made on acceptance, so most of what
 * matters here is about *when* things exist: nothing in the recipient's account
 * before they accept, one trip however many times they press the button, and an
 * offer that still opens after the trip it came from is gone.
 */

const TRIPS = '/api/trips';

function tripBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Berlin in Early Autumn',
    destination: 'Berlin, Germany',
    destinationCity: 'Berlin',
    destinationCountry: 'Germany',
    startDate: '2026-09-07',
    endDate: '2026-09-11',
    travellers: 2,
    coverImage: '/assets/city-9f2a1b.jpg',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2026-09-07',
        destination: 'Berlin',
        summary: 'Arrive and wander',
        activities: [
          {
            id: 'act_1',
            time: '10:00',
            title: 'Tiergarten',
            description: 'A long walk',
            category: 'nature',
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** The snapshot a browser builds: the trip, plus each photograph's stable name. */
function snapshot(overrides: Record<string, unknown> = {}) {
  const { title, destination, destinationCity, destinationCountry, startDate, endDate, travellers, coverImage, itinerary } =
    tripBody();

  return {
    title,
    destination,
    destinationCity,
    destinationCountry,
    startDate,
    endDate,
    travellers,
    coverImage,
    coverImageId: 'city',
    itinerary,
    ...overrides,
  };
}

/** Two accounts, and a trip belonging to the first. */
async function pairWithTrip() {
  const alice = await signUp({ email: 'alice@example.com', name: 'Alice' });
  const bob = await signUp({ email: 'bob@example.com', name: 'Bob' });

  const auth = { alice: `Bearer ${alice.accessToken}`, bob: `Bearer ${bob.accessToken}` };

  const trip = await api()
    .post(TRIPS)
    .set('Authorization', auth.alice)
    .send(tripBody())
    .expect(201);

  return { alice: alice.user, bob: bob.user, auth, trip: trip.body };
}

/** Alice offers her trip to Bob, and hands back the message that carries it. */
async function share(context: Awaited<ReturnType<typeof pairWithTrip>>, body = {}) {
  const response = await api()
    .post(`${TRIPS}/${context.trip.id}/share`)
    .set('Authorization', context.auth.alice)
    .send({ toUserId: context.bob.id, trip: snapshot(), clientMessageId: 'cm_share_1', ...body })
    .expect(201);

  return response.body;
}

describe('authentication', () => {
  it.each([
    ['post', '/api/trips/trip_1/share'],
    ['get', '/api/shares/s_1'],
    ['post', '/api/shares/s_1/accept'],
    ['delete', '/api/shares/s_1'],
  ])('refuses %s %s with no token', async (method, path) => {
    const response = await api()[method as 'get'](path).expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('offering a trip', () => {
  it('lands in the conversation as a message with a card on it', async () => {
    const context = await pairWithTrip();

    const message = await share(context);

    expect(message.senderId).toBe(context.alice.id);
    expect(message.recipientId).toBe(context.bob.id);
    expect(message.share).toMatchObject({
      title: 'Berlin in Early Autumn',
      destination: 'Berlin, Germany',
      startDate: '2026-09-07',
      dayCount: 1,
      acceptedAt: null,
      revokedAt: null,
    });
  });

  it('writes a body the rest of the app can read', async () => {
    const context = await pairWithTrip();

    const message = await share(context);

    // The conversation list preview, and what a screen reader reads. A card is
    // not something either of those can render.
    expect(message.body).toBe('Shared a trip: Berlin in Early Autumn');
  });

  it('shows up in the thread for both of them', async () => {
    const context = await pairWithTrip();
    await share(context);

    const asBob = await api()
      .get(`/api/messages/with/${context.alice.id}`)
      .set('Authorization', context.auth.bob)
      .expect(200);

    expect(asBob.body).toHaveLength(1);
    expect(asBob.body[0].share.title).toBe('Berlin in Early Autumn');
  });

  it('puts nothing in the recipient’s trips', async () => {
    const context = await pairWithTrip();
    await share(context);

    const trips = await api().get(TRIPS).set('Authorization', context.auth.bob).expect(200);

    // An offer, never a conversion. This is the line the whole feature rests on.
    expect(trips.body).toHaveLength(0);
  });

  it('refuses a trip that is not yours', async () => {
    const context = await pairWithTrip();

    const response = await api()
      .post(`${TRIPS}/${context.trip.id}/share`)
      .set('Authorization', context.auth.bob)
      .send({ toUserId: context.alice.id, trip: snapshot() })
      .expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('refuses an unknown recipient, and yourself', async () => {
    const context = await pairWithTrip();

    await api()
      .post(`${TRIPS}/${context.trip.id}/share`)
      .set('Authorization', context.auth.alice)
      .send({ toUserId: 'u_nobody', trip: snapshot() })
      .expect(404);

    await api()
      .post(`${TRIPS}/${context.trip.id}/share`)
      .set('Authorization', context.auth.alice)
      .send({ toUserId: context.alice.id, trip: snapshot() })
      .expect(422);
  });

  it('refuses a snapshot that is not shaped like a trip', async () => {
    const context = await pairWithTrip();

    const response = await api()
      .post(`${TRIPS}/${context.trip.id}/share`)
      .set('Authorization', context.auth.alice)
      .send({ toUserId: context.bob.id, trip: { title: '' } })
      .expect(422);

    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('offers once however many times the button is pressed', async () => {
    const context = await pairWithTrip();

    const first = await share(context);
    const second = await share(context);

    // The same retry story a written message has, for the same reason: a cold
    // instance takes a minute to answer.
    expect(second.id).toBe(first.id);
    expect(second.share.id).toBe(first.share.id);
  });
});

describe('reading an offer', () => {
  it('hands the itinerary to either party', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    for (const auth of [context.auth.alice, context.auth.bob]) {
      const response = await api()
        .get(`/api/shares/${message.share.id}`)
        .set('Authorization', auth)
        .expect(200);

      expect(response.body.share.id).toBe(message.share.id);
      expect(response.body.trip.itinerary).toHaveLength(1);
      // The stable name of the photograph, which is the half that survives a
      // change of build — see `share.schemas.ts`.
      expect(response.body.trip.coverImageId).toBe('city');
    }
  });

  it('is nobody else’s business', async () => {
    const context = await pairWithTrip();
    const message = await share(context);
    const carol = await signUp({ email: 'carol@example.com', name: 'Carol' });

    const response = await api()
      .get(`/api/shares/${message.share.id}`)
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.SHARE_NOT_FOUND);
  });

  it('still opens after the original trip is deleted', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    await api()
      .delete(`${TRIPS}/${context.trip.id}`)
      .set('Authorization', context.auth.alice)
      .expect(204);

    // The snapshot is the offer. Deleting what it was made from must not take
    // a card off somebody else's screen.
    const response = await api()
      .get(`/api/shares/${message.share.id}`)
      .set('Authorization', context.auth.bob)
      .expect(200);

    expect(response.body.trip.title).toBe('Berlin in Early Autumn');
  });
});

describe('accepting', () => {
  it('makes a copy in the recipient’s account', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    const accepted = await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.bob)
      .send(tripBody())
      .expect(201);

    expect(accepted.body.title).toBe('Berlin in Early Autumn');
    // A copy: a new id, in Bob's account, leaving Alice's where it was.
    expect(accepted.body.id).not.toBe(context.trip.id);

    const trips = await api().get(TRIPS).set('Authorization', context.auth.bob).expect(200);
    expect(trips.body).toHaveLength(1);
  });

  it('marks the card for both of them', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.bob)
      .send(tripBody())
      .expect(201);

    const thread = await api()
      .get(`/api/messages/with/${context.bob.id}`)
      .set('Authorization', context.auth.alice)
      .expect(200);

    // The sender's card changing is the whole reward for having shared it.
    expect(thread.body[0].share.acceptedAt).not.toBeNull();
  });

  it('makes one trip however many times it is pressed', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    const first = await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.bob)
      .send(tripBody())
      .expect(201);

    const second = await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.bob)
      .send(tripBody())
      .expect(201);

    // Idempotent through a `draftId` derived from the share, so a double tap
    // on a slow instance cannot leave two copies behind.
    expect(second.body.id).toBe(first.body.id);

    const trips = await api().get(TRIPS).set('Authorization', context.auth.bob).expect(200);
    expect(trips.body).toHaveLength(1);
  });

  it('is not the sender’s to accept', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    const response = await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.alice)
      .send(tripBody())
      .expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.SHARE_NOT_FOUND);
  });

  it('refuses a withdrawn offer', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    await api()
      .delete(`/api/shares/${message.share.id}`)
      .set('Authorization', context.auth.alice)
      .expect(204);

    const response = await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.bob)
      .send(tripBody())
      .expect(410);

    expect(errorCode(response)).toBe(ERROR_CODES.SHARE_REVOKED);
  });
});

describe('withdrawing', () => {
  it('marks the card on both sides', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    await api()
      .delete(`/api/shares/${message.share.id}`)
      .set('Authorization', context.auth.alice)
      .expect(204);

    const thread = await api()
      .get(`/api/messages/with/${context.alice.id}`)
      .set('Authorization', context.auth.bob)
      .expect(200);

    expect(thread.body[0].share.revokedAt).not.toBeNull();
  });

  it('is only the sender’s to do', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    const response = await api()
      .delete(`/api/shares/${message.share.id}`)
      .set('Authorization', context.auth.bob)
      .expect(403);

    expect(errorCode(response)).toBe(ERROR_CODES.SHARE_NOT_YOURS);
  });

  it('will not take back a trip somebody already has', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    await api()
      .post(`/api/shares/${message.share.id}/accept`)
      .set('Authorization', context.auth.bob)
      .send(tripBody())
      .expect(201);

    const response = await api()
      .delete(`/api/shares/${message.share.id}`)
      .set('Authorization', context.auth.alice)
      .expect(409);

    // Reaching into another account to delete a trip is not what revoke means.
    expect(errorCode(response)).toBe(ERROR_CODES.SHARE_REVOKED);
  });
});

describe('privacy', () => {
  it('never puts an email on a card', async () => {
    const context = await pairWithTrip();
    const message = await share(context);

    const thread = await api()
      .get(`/api/messages/with/${context.alice.id}`)
      .set('Authorization', context.auth.bob)
      .expect(200);

    expect(JSON.stringify(thread.body)).not.toContain('@example.com');
    expect(JSON.stringify(message)).not.toContain('@example.com');
  });
});
