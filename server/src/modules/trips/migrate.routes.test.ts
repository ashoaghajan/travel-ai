import { describe, expect, it } from 'vitest';
import { api, signUp } from '../../test/harness';

/**
 * `POST /api/migrate/local`.
 *
 * The one endpoint here that touches data nobody can get back. Everyone who
 * used this app before the trips API has their trips in one browser and
 * nowhere else, so the rules worth pinning are about not losing them: running
 * it twice must not duplicate anything, a trip already in the database must
 * not be overwritten by an older copy, and a rejected payload must leave the
 * account unmarked so the next attempt can still succeed.
 */

const MIGRATE = '/api/migrate/local';
const TRIPS = '/api/trips';

function localTrip(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
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
        activities: [],
      },
    ],
    ...overrides,
  };
}

describe('POST /api/migrate/local', () => {
  it('refuses without a token', async () => {
    await api().post(MIGRATE).send({ trips: [] }).expect(401);
  });

  it('imports the browser’s trips into the account', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    const response = await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_a'), localTrip('trip_b')] })
      .expect(200);

    expect(response.body).toEqual({ alreadyMigrated: false, imported: 2 });

    const list = await api().get(TRIPS).set('Authorization', auth).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('preserves the ids the browser minted', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_keepme')] })
      .expect(200);

    // Preserving them is what makes this endpoint idempotent, and it is also
    // what keeps a bookmarked trip address working after the move.
    await api().get(`${TRIPS}/trip_keepme`).set('Authorization', auth).expect(200);
  });

  it('is a no-op success the second time', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().post(MIGRATE).set('Authorization', auth).send({ trips: [localTrip('trip_a')] });

    const second = await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_a')] })
      .expect(200);

    // A success rather than a 409: there is nothing the client can do about
    // it, and a no-op is far easier to handle than an error to special-case.
    expect(second.body.alreadyMigrated).toBe(true);

    const list = await api().get(TRIPS).set('Authorization', auth).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('does not overwrite a trip that has since been edited', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().post(MIGRATE).set('Authorization', auth).send({ trips: [localTrip('trip_a')] });
    await api()
      .patch(`${TRIPS}/trip_a`)
      .set('Authorization', auth)
      .send({ title: 'Edited on another device' })
      .expect(200);

    // A second browser arrives holding the pre-edit copy. Its data is older,
    // so importing it must not undo the edit.
    const { accessToken: sameUserSecondCall } = { accessToken };
    await api()
      .post(MIGRATE)
      .set('Authorization', `Bearer ${sameUserSecondCall}`)
      .send({ trips: [localTrip('trip_a', { title: 'The stale copy' })] })
      .expect(200);

    const trip = await api().get(`${TRIPS}/trip_a`).set('Authorization', auth).expect(200);
    expect(trip.body.title).toBe('Edited on another device');
  });

  it('records the active trip when the import established it', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_a')], activeTripId: 'trip_a' })
      .expect(200);

    const me = await api().get('/api/me').set('Authorization', auth).expect(200);
    expect(me.body.activeTripId).toBe('trip_a');
  });

  it('ignores an active trip that is not among the imported ones', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_a')], activeTripId: 'trip_somewhere_else' })
      .expect(200);

    // Never point at a row that does not exist — the foreign key would refuse
    // it anyway, and failing the whole import over a stale pointer would be a
    // poor trade.
    const me = await api().get('/api/me').set('Authorization', auth).expect(200);
    expect(me.body.activeTripId).toBeNull();
  });

  it('accepts an empty payload', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .post(MIGRATE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ trips: [] })
      .expect(200);

    expect(response.body.imported).toBe(0);
  });

  it('keeps one account’s import out of another', async () => {
    const mine = await signUp();
    const theirs = await signUp({ email: 'other@example.com' });

    await api()
      .post(MIGRATE)
      .set('Authorization', `Bearer ${mine.accessToken}`)
      .send({ trips: [localTrip('trip_a')] })
      .expect(200);

    const list = await api()
      .get(TRIPS)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200);

    expect(list.body).toEqual([]);
  });

  it('refuses an id this app did not mint', async () => {
    const { accessToken } = await signUp();

    // Ids become primary keys here, so their shape is checked rather than
    // trusted — the owner scoping is the real fence, this is the second one.
    await api()
      .post(MIGRATE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ trips: [localTrip('../../etc/passwd')] })
      .expect(422);
  });

  it('leaves the account unmarked when the payload is rejected', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_a', { title: '' })] })
      .expect(422);

    // The marker must not be set by a failed attempt, or the reader's trips
    // are stranded on their disk with the account believing it has them.
    const retry = await api()
      .post(MIGRATE)
      .set('Authorization', auth)
      .send({ trips: [localTrip('trip_a')] })
      .expect(200);

    expect(retry.body).toEqual({ alreadyMigrated: false, imported: 1 });
  });
});
