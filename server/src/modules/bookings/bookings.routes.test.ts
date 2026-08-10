import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { api, errorCode, signUp } from '../../test/harness';

/**
 * `/api/bookings`.
 *
 * The rule that shapes most of this: a booking is a fact, not a plan. It
 * outlives the search that produced it, it can exist before anyone has decided
 * which trip it is for, and — the one worth testing hardest — it survives the
 * deletion of the trip it was made for. A confirmation number for a flight
 * that was actually paid for must not disappear because someone abandoned the
 * itinerary around it.
 */

const BOOKINGS = '/api/bookings';
const TRIPS = '/api/trips';

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    tripId: null,
    kind: 'flight',
    status: 'saved',
    title: 'Air Arabia · EVN → AUH',
    date: '2027-09-11',
    reference: '',
    ...overrides,
  };
}

function tripBody() {
  return {
    title: 'A week in Yerevan',
    destination: 'Yerevan',
    destinationCity: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/y.jpg',
    itinerary: [],
  };
}

/** An account with one trip, ready to hang bookings off. */
async function withTrip() {
  const { accessToken } = await signUp();
  const auth = `Bearer ${accessToken}`;
  const trip = await api().post(TRIPS).set('Authorization', auth).send(tripBody()).expect(201);

  return { auth, accessToken, tripId: trip.body.id as string };
}

describe('authentication', () => {
  it('refuses a listing with no token', async () => {
    const response = await api().get(BOOKINGS).expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('ownership', () => {
  it('lists only the caller’s bookings', async () => {
    const { auth } = await withTrip();
    await api().post(BOOKINGS).set('Authorization', auth).send(bookingBody()).expect(201);

    const theirs = await signUp({ email: 'other@example.com' });
    const response = await api()
      .get(BOOKINGS)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('refuses to file a booking against someone else’s trip', async () => {
    const mine = await withTrip();
    const theirs = await signUp({ email: 'other@example.com' });

    // Otherwise anyone could learn which trip ids are real by which attempts
    // succeeded.
    await api()
      .post(BOOKINGS)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .send(bookingBody({ tripId: mine.tripId }))
      .expect(404);
  });

  it('refuses to patch someone else’s booking', async () => {
    const { auth } = await withTrip();
    const created = await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody())
      .expect(201);

    const theirs = await signUp({ email: 'other@example.com' });
    await api()
      .patch(`${BOOKINGS}/${created.body.id}`)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .send({ reference: 'STOLEN' })
      .expect(404);
  });
});

describe('POST /api/bookings', () => {
  it('records a booking with no trip', async () => {
    const { accessToken } = await signUp();

    // You can find a fare before deciding which trip it is for; demanding one
    // at that moment is what would push someone back to the partner with
    // nothing recorded.
    const response = await api()
      .post(BOOKINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(bookingBody())
      .expect(201);

    expect(response.body).toMatchObject({ tripId: null, status: 'saved' });
    expect(response.body.id).toMatch(/^bkg_/);
  });

  it('accepts a booking with no date', async () => {
    const { accessToken } = await signUp();

    // The bookings tab groups an undated row on its own rather than guessing
    // at the trip's start.
    await api()
      .post(BOOKINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(bookingBody({ date: '' }))
      .expect(201);
  });

  it('keeps the source snapshot it was given', async () => {
    const { auth, tripId } = await withTrip();

    const response = await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(
        bookingBody({
          tripId,
          source: { provider: 'travelpayouts', resultId: 'fare_1', capturedAt: 'x', price: 412 },
        }),
      )
      .expect(201);

    // A snapshot, not a reference: the search that produced it will not return
    // the same row tomorrow.
    expect(response.body.source).toMatchObject({ resultId: 'fare_1', price: 412 });
  });

  it('refuses the same search result on the same trip twice', async () => {
    const { auth, tripId } = await withTrip();
    const body = bookingBody({
      tripId,
      source: { provider: 'travelpayouts', resultId: 'fare_1', capturedAt: 'x' },
    });

    await api().post(BOOKINGS).set('Authorization', auth).send(body).expect(201);
    const response = await api().post(BOOKINGS).set('Authorization', auth).send(body).expect(409);

    expect(errorCode(response)).toBe(ERROR_CODES.BOOKING_ALREADY_ON_TRIP);
  });

  it('allows the same fare on two different trips', async () => {
    const { auth, tripId } = await withTrip();
    const second = await api().post(TRIPS).set('Authorization', auth).send(tripBody()).expect(201);
    const source = { provider: 'travelpayouts', resultId: 'fare_1', capturedAt: 'x' };

    await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody({ tripId, source }))
      .expect(201);

    // Legitimate: the same flight can genuinely be on two itineraries.
    await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody({ tripId: second.body.id, source }))
      .expect(201);
  });

  it('never calls a hand-typed booking a duplicate', async () => {
    const { auth, tripId } = await withTrip();

    await api().post(BOOKINGS).set('Authorization', auth).send(bookingBody({ tripId })).expect(201);
    await api().post(BOOKINGS).set('Authorization', auth).send(bookingBody({ tripId })).expect(201);
  });

  it('files a batch in one transaction', async () => {
    const { auth, tripId } = await withTrip();

    const response = await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send({
        bookings: [
          bookingBody({ tripId, title: 'Outbound' }),
          bookingBody({ tripId, title: 'Return' }),
        ],
      })
      .expect(201);

    expect(response.body).toHaveLength(2);
  });

  it('writes none of a batch when one of them is refused', async () => {
    const { auth, tripId } = await withTrip();
    const source = { provider: 'otm', resultId: 'already', capturedAt: 'x' };
    await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody({ tripId, source }))
      .expect(201);

    await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send({
        bookings: [bookingBody({ tripId, title: 'Fine' }), bookingBody({ tripId, source })],
      })
      .expect(409);

    // All or none: a reader must not end up with half a trip recorded.
    const list = await api().get(BOOKINGS).set('Authorization', auth).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('refuses a booking with no title', async () => {
    const { accessToken } = await signUp();

    await api()
      .post(BOOKINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(bookingBody({ title: '  ' }))
      .expect(422);
  });

  it('refuses a kind it does not recognise', async () => {
    const { accessToken } = await signUp();

    await api()
      .post(BOOKINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(bookingBody({ kind: 'submarine' }))
      .expect(422);
  });
});

describe('PATCH /api/bookings/:id', () => {
  async function withBooking() {
    const { auth, tripId } = await withTrip();
    const created = await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody({ tripId, price: 412, priceBasis: { unit: 'perPerson', units: 2 } }))
      .expect(201);

    return { auth, tripId, id: created.body.id as string };
  }

  it('records a confirmation number', async () => {
    const { auth, id } = await withBooking();

    const response = await api()
      .patch(`${BOOKINGS}/${id}`)
      .set('Authorization', auth)
      .send({ reference: 'ABC123', status: 'booked' })
      .expect(200);

    expect(response.body).toMatchObject({ reference: 'ABC123', status: 'booked' });
  });

  it('detaches a booking when tripId is null', async () => {
    const { auth, id } = await withBooking();

    const response = await api()
      .patch(`${BOOKINGS}/${id}`)
      .set('Authorization', auth)
      .send({ tripId: null })
      .expect(200);

    expect(response.body.tripId).toBeNull();
  });

  it('clears the price basis when sent null', async () => {
    const { auth, id } = await withBooking();

    const response = await api()
      .patch(`${BOOKINGS}/${id}`)
      .set('Authorization', auth)
      .send({ price: 800, priceBasis: null })
      .expect(200);

    // A price the reader typed is what the line cost, not a rate — otherwise
    // correcting a hotel row to the $800 paid makes it $800 a night.
    expect(response.body.priceBasis).toBeUndefined();
  });

  it('leaves the fields a patch did not mention', async () => {
    const { auth, id } = await withBooking();

    const response = await api()
      .patch(`${BOOKINGS}/${id}`)
      .set('Authorization', auth)
      .send({ reference: 'ABC123' })
      .expect(200);

    expect(response.body.price).toBe(412);
  });

  it('is a 404 for a booking that does not exist', async () => {
    const { auth } = await withTrip();

    const response = await api()
      .patch(`${BOOKINGS}/bkg_nope`)
      .set('Authorization', auth)
      .send({ reference: 'x' })
      .expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.BOOKING_NOT_FOUND);
  });
});

describe('DELETE /api/bookings/:id', () => {
  it('removes the booking and is idempotent', async () => {
    const { auth } = await withTrip();
    const created = await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody())
      .expect(201);

    await api().delete(`${BOOKINGS}/${created.body.id}`).set('Authorization', auth).expect(204);
    await api().delete(`${BOOKINGS}/${created.body.id}`).set('Authorization', auth).expect(204);

    const list = await api().get(BOOKINGS).set('Authorization', auth).expect(200);
    expect(list.body).toEqual([]);
  });
});

describe('when the trip is deleted', () => {
  it('keeps the booking, unassigned', async () => {
    const { auth, tripId } = await withTrip();
    await api()
      .post(BOOKINGS)
      .set('Authorization', auth)
      .send(bookingBody({ tripId, reference: 'ABC123', status: 'booked' }))
      .expect(201);

    await api().delete(`${TRIPS}/${tripId}`).set('Authorization', auth).expect(204);

    /*
     * The whole reason `tripId` is a relation with SetNull rather than a loose
     * string. An itinerary activity is a guess; a booking is a fact, and a
     * confirmation number for a flight that was paid for must survive the plan
     * it was made under.
     */
    const list = await api().get(BOOKINGS).set('Authorization', auth).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ tripId: null, reference: 'ABC123' });
  });
});
