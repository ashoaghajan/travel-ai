import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { api, errorCode, signUp } from '../../test/harness';

/**
 * `/api/trips`.
 *
 * The rule that matters most here is ownership: every query is scoped by the
 * id in the verified token, and a trip belonging to someone else must be
 * indistinguishable from one that does not exist. A 404 that only fires for
 * genuinely-absent ids is an oracle telling a stranger which trip ids are real.
 *
 * After that: saving the same draft twice must not make two trips, clearing a
 * field must actually clear it, and two edits to one trip must not silently
 * overwrite each other.
 */

const TRIPS = '/api/trips';

function tripBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A week in Yerevan',
    destination: 'Yerevan',
    destinationCity: 'Yerevan',
    destinationCountry: 'Armenia',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2027-09-02',
        destination: 'Yerevan',
        summary: 'Arrival',
        activities: [
          {
            id: 'act_1',
            time: '14:00',
            title: 'Cascade',
            description: 'Stairs and sculpture.',
            category: 'culture',
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** An account with one trip already saved. */
async function withTrip(overrides: Record<string, unknown> = {}) {
  const { accessToken } = await signUp();
  const response = await api()
    .post(TRIPS)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(tripBody(overrides))
    .expect(201);

  return { accessToken, trip: response.body, auth: `Bearer ${accessToken}` };
}

describe('authentication', () => {
  it('refuses a listing with no token', async () => {
    const response = await api().get(TRIPS).expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a save with no token', async () => {
    await api().post(TRIPS).send(tripBody()).expect(401);
  });
});

describe('what mounting at /api must not break', () => {
  it('leaves the unauthenticated reference routes open', async () => {
    /*
     * A regression guard, not a feature.
     *
     * `tripsRouter` is mounted at `/api` so its paths can be domain-shaped.
     * Guarding it with `router.use(requireAuth)` runs that middleware for
     * every request reaching `/api`, including the public reference endpoints
     * mounted after it — turning them all into 401s. Attaching `requireAuth`
     * per route is what keeps them reachable, and nothing else in the suite
     * would notice if that changed back.
     */
    const response = await api().get('/api/health');

    expect(response.status).toBe(200);
  });

  it('still refuses an unauthenticated trips request', async () => {
    await api().get(TRIPS).expect(401);
  });
});

describe('ownership', () => {
  it('lists only the caller’s trips', async () => {
    const mine = await withTrip();
    const theirs = await signUp({ email: 'other@example.com' });

    const response = await api()
      .get(TRIPS)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200);

    expect(response.body).toEqual([]);
    expect(mine.trip.id).toBeDefined();
  });

  it('answers 404 for someone else’s trip, not 403', async () => {
    const mine = await withTrip();
    const theirs = await signUp({ email: 'other@example.com' });

    const response = await api()
      .get(`${TRIPS}/${mine.trip.id}`)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(404);

    // 403 would confirm the id exists. A stranger learns nothing from a 404.
    expect(errorCode(response)).toBe(ERROR_CODES.TRIP_NOT_FOUND);
  });

  it('refuses to patch someone else’s trip', async () => {
    const mine = await withTrip();
    const theirs = await signUp({ email: 'other@example.com' });

    await api()
      .patch(`${TRIPS}/${mine.trip.id}`)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .send({ title: 'Stolen' })
      .expect(404);
  });

  it('refuses to delete someone else’s trip', async () => {
    const mine = await withTrip();
    const theirs = await signUp({ email: 'other@example.com' });

    await api()
      .delete(`${TRIPS}/${mine.trip.id}`)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(204);

    // Idempotent for the caller, but it must not have touched the real owner's.
    await api().get(`${TRIPS}/${mine.trip.id}`).set('Authorization', mine.auth).expect(200);
  });
});

describe('POST /api/trips', () => {
  it('saves a trip and returns it', async () => {
    const { trip } = await withTrip();

    expect(trip).toMatchObject({ title: 'A week in Yerevan', travellers: 2, version: 0 });
    expect(trip.id).toMatch(/^trip_/);
  });

  it('keeps the itinerary byte-identical', async () => {
    const { trip } = await withTrip();

    expect(trip.itinerary).toEqual(tripBody().itinerary);
  });

  it('returns the existing trip when the same draft is saved again', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    const first = await api()
      .post(TRIPS)
      .set('Authorization', auth)
      .send(tripBody({ draftId: 'draft_1' }))
      .expect(201);

    // 200, not 201: this call did not create anything.
    const second = await api()
      .post(TRIPS)
      .set('Authorization', auth)
      .send(tripBody({ draftId: 'draft_1', title: 'Changed my mind' }))
      .expect(200);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.title).toBe('A week in Yerevan');

    const list = await api().get(TRIPS).set('Authorization', auth).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('lets two accounts use the same draft id', async () => {
    const mine = await signUp();
    const theirs = await signUp({ email: 'other@example.com' });

    await api()
      .post(TRIPS)
      .set('Authorization', `Bearer ${mine.accessToken}`)
      .send(tripBody({ draftId: 'draft_shared' }))
      .expect(201);

    // The uniqueness is per account; a draft id is not globally reserved.
    await api()
      .post(TRIPS)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .send(tripBody({ draftId: 'draft_shared' }))
      .expect(201);
  });

  it('makes two trips from two drafts with no draft id', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().post(TRIPS).set('Authorization', auth).send(tripBody()).expect(201);
    await api().post(TRIPS).set('Authorization', auth).send(tripBody()).expect(201);

    const list = await api().get(TRIPS).set('Authorization', auth).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('lists newest first', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().post(TRIPS).set('Authorization', auth).send(tripBody({ title: 'Older' })).expect(201);
    await api().post(TRIPS).set('Authorization', auth).send(tripBody({ title: 'Newer' })).expect(201);

    const list = await api().get(TRIPS).set('Authorization', auth).expect(200);
    expect(list.body[0].title).toBe('Newer');
  });
});

describe('POST /api/trips validation', () => {
  async function reject(overrides: Record<string, unknown>) {
    const { accessToken } = await signUp();

    return api()
      .post(TRIPS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(tripBody(overrides))
      .expect(422);
  }

  it('refuses a trip with no title', async () => {
    await reject({ title: '   ' });
  });

  it('refuses an end date before the start', async () => {
    await reject({ startDate: '2027-09-06', endDate: '2027-09-02' });
  });

  it('refuses fewer than one traveller', async () => {
    await reject({ travellers: 0 });
  });

  it('refuses a trip that names nowhere', async () => {
    await reject({ destination: '', destinationCity: null, destinationCountry: null });
  });

  it('refuses an activity time that is not a 24-hour clock', async () => {
    // The client checks this too, but that is UX. This is the enforcement.
    await reject({
      itinerary: [
        {
          id: 'day_1',
          dayNumber: 1,
          date: '2027-09-02',
          destination: 'Yerevan',
          summary: '',
          activities: [
            { id: 'a', time: '25:00', title: 'Impossible', description: '', category: 'culture' },
          ],
        },
      ],
    });
  });

  it('refuses an activity with no title', async () => {
    await reject({
      itinerary: [
        {
          id: 'day_1',
          dayNumber: 1,
          date: '2027-09-02',
          destination: 'Yerevan',
          summary: '',
          activities: [
            { id: 'a', time: '09:30', title: '  ', description: '', category: 'culture' },
          ],
        },
      ],
    });
  });
});

describe('PATCH /api/trips/:id', () => {
  it('applies the change and bumps the version', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({ title: 'Ten days in Yerevan' })
      .expect(200);

    expect(response.body.title).toBe('Ten days in Yerevan');
    expect(response.body.version).toBe(1);
  });

  it('leaves fields the patch did not mention', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({ title: 'Renamed' })
      .expect(200);

    expect(response.body.travellers).toBe(2);
    expect(response.body.destinationCountry).toBe('Armenia');
  });

  it('clears a field when the patch sends null', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({ destinationCountry: null })
      .expect(200);

    // The reason the patch schema is hand-written: `undefined` does not
    // survive JSON, so "clear this" needs a value of its own.
    expect(response.body.destinationCountry).toBeUndefined();
  });

  it('accepts an empty patch as a touch', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    // The summary screen's Save sends `{}` deliberately, to refresh updatedAt.
    expect(response.body.version).toBe(1);
  });

  it('refuses an edit against a stale version', async () => {
    const { trip, auth } = await withTrip();

    await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({ title: 'First', version: 0 })
      .expect(200);

    // The second tab still believes it is editing version 0.
    const response = await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({ title: 'Second', version: 0 })
      .expect(409);

    expect(errorCode(response)).toBe(ERROR_CODES.STALE_TRIP);
  });

  it('refuses a patch that would end the trip before it starts', async () => {
    const { trip, auth } = await withTrip();

    // Only one half is being changed, so the pair has to be checked against
    // what is already stored rather than within the patch alone.
    await api()
      .patch(`${TRIPS}/${trip.id}`)
      .set('Authorization', auth)
      .send({ endDate: '2027-08-01' })
      .expect(422);
  });

  it('is a 404 for a trip that does not exist', async () => {
    const { accessToken } = await signUp();

    await api()
      .patch(`${TRIPS}/trip_nope`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'x' })
      .expect(404);
  });
});

describe('DELETE /api/trips/:id', () => {
  it('removes the trip', async () => {
    const { trip, auth } = await withTrip();

    await api().delete(`${TRIPS}/${trip.id}`).set('Authorization', auth).expect(204);
    await api().get(`${TRIPS}/${trip.id}`).set('Authorization', auth).expect(404);
  });

  it('is idempotent', async () => {
    const { trip, auth } = await withTrip();

    await api().delete(`${TRIPS}/${trip.id}`).set('Authorization', auth).expect(204);

    // Deleting a trip that is already gone is the outcome the caller wanted.
    await api().delete(`${TRIPS}/${trip.id}`).set('Authorization', auth).expect(204);
  });
});

describe('POST /api/trips/:id/days/:dayId/activities', () => {
  const attraction = {
    activity: {
      id: 'otm_matenadaran',
      title: 'Matenadaran',
      description: 'A library of manuscripts.',
      category: 'culture',
      price: 0,
      image: '',
    },
  };

  it('adds the attraction to the day', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
      .set('Authorization', auth)
      .send(attraction)
      .expect(200);

    expect(response.body.itinerary[0].activities).toHaveLength(2);
  });

  it('keeps the day in time order', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
      .set('Authorization', auth)
      .send({ ...attraction, time: '09:30' })
      .expect(200);

    // An import lands where it belongs rather than at the bottom.
    expect(
      response.body.itinerary[0].activities.map((entry: { time: string }) => entry.time),
    ).toEqual(['09:30', '14:00']);
  });

  it('defaults to midday when no time is given', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
      .set('Authorization', auth)
      .send(attraction)
      .expect(200);

    const added = response.body.itinerary[0].activities.find(
      (entry: { sourceActivityId?: string }) => entry.sourceActivityId === 'otm_matenadaran',
    );
    expect(added.time).toBe('12:00');
  });

  it('refuses the same attraction twice', async () => {
    const { trip, auth } = await withTrip();

    await api()
      .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
      .set('Authorization', auth)
      .send(attraction)
      .expect(200);

    const response = await api()
      .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
      .set('Authorization', auth)
      .send(attraction)
      .expect(409);

    // Two identical rows are worse than a message saying why not.
    expect(errorCode(response)).toBe(ERROR_CODES.ACTIVITY_ALREADY_ON_DAY);
  });

  it('is a 404 for a day that is not on the trip', async () => {
    const { trip, auth } = await withTrip();

    const response = await api()
      .post(`${TRIPS}/${trip.id}/days/day_nope/activities`)
      .set('Authorization', auth)
      .send(attraction)
      .expect(404);

    expect(errorCode(response)).toBe(ERROR_CODES.DAY_NOT_FOUND);
  });

  it('keeps both when two attractions are added at once', async () => {
    const { trip, auth } = await withTrip();

    await Promise.all([
      api()
        .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
        .set('Authorization', auth)
        .send(attraction),
      api()
        .post(`${TRIPS}/${trip.id}/days/day_1/activities`)
        .set('Authorization', auth)
        .send({ activity: { ...attraction.activity, id: 'otm_cascade', title: 'Cascade steps' } }),
    ]);

    // The day is one JSON value, so a lost update loses a whole activity
    // rather than a field. The row lock is what stops that.
    const after = await api().get(`${TRIPS}/${trip.id}`).set('Authorization', auth).expect(200);
    expect(after.body.itinerary[0].activities).toHaveLength(3);
  });
});

describe('PUT /api/me/active-trip', () => {
  it('records the trip last opened', async () => {
    const { trip, auth } = await withTrip();

    await api()
      .put('/api/me/active-trip')
      .set('Authorization', auth)
      .send({ tripId: trip.id })
      .expect(204);

    const me = await api().get('/api/me').set('Authorization', auth).expect(200);
    expect(me.body.activeTripId).toBe(trip.id);
  });

  it('clears the pointer when sent null', async () => {
    const { trip, auth } = await withTrip();
    await api().put('/api/me/active-trip').set('Authorization', auth).send({ tripId: trip.id });

    await api().put('/api/me/active-trip').set('Authorization', auth).send({ tripId: null }).expect(204);

    const me = await api().get('/api/me').set('Authorization', auth).expect(200);
    expect(me.body.activeTripId).toBeNull();
  });

  it('refuses to point at someone else’s trip', async () => {
    const mine = await withTrip();
    const theirs = await signUp({ email: 'other@example.com' });

    await api()
      .put('/api/me/active-trip')
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .send({ tripId: mine.trip.id })
      .expect(404);
  });

  it('goes null by itself when the trip is deleted', async () => {
    const { trip, auth } = await withTrip();
    await api().put('/api/me/active-trip').set('Authorization', auth).send({ tripId: trip.id });

    await api().delete(`${TRIPS}/${trip.id}`).set('Authorization', auth).expect(204);

    // `onDelete: SetNull` — never leave the pointer aimed at a row that is gone.
    const me = await api().get('/api/me').set('Authorization', auth).expect(200);
    expect(me.body.activeTripId).toBeNull();
  });
});
