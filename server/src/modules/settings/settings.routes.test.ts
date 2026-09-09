import { describe, expect, it } from 'vitest';
import { api, signUp } from '../../test/harness';

/**
 * `/api/settings`.
 *
 * Two things here matter more than the CRUD. Every account has settings
 * whether or not a row exists for it, so a brand-new account must get a
 * complete record rather than nulls. And a patch merges rather than replaces —
 * the screen writes one toggle at a time, so replacing the notifications
 * object would reset the other switch every time either was touched.
 */

const SETTINGS = '/api/settings';

const DEFAULT_TRAVEL = {
  dayStart: '09:30',
  dayEnd: '18:00',
  pace: 'balanced',
  categoryWeights: {
    food: 0.5,
    nature: 0.5,
    culture: 0.5,
    adventure: 0.5,
    relaxation: 0.5,
    travel: 0,
  },
  maxActivityPrice: null,
  dailyActivityBudget: null,
  meals: { lunch: true, dinner: true },
  maxDistanceFromHotelKm: null,
  nearMetroOnly: false,
};

const DEFAULTS = {
  theme: 'sharpen',
  currency: 'USD',
  notifications: { tripReminders: true, priceAlerts: false },
  travel: DEFAULT_TRAVEL,
};

describe('authentication', () => {
  it('refuses a read with no token', async () => {
    await api().get(SETTINGS).expect(401);
  });

  it('refuses a write with no token', async () => {
    await api().put(SETTINGS).send({ theme: 'atlas' }).expect(401);
  });
});

describe('GET /api/settings', () => {
  it('gives a new account the defaults', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .get(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // No row is written at registration — sign-up stays one insert, and an
    // account that never opens this screen costs no storage.
    expect(response.body).toEqual(DEFAULTS);
  });
});

describe('PUT /api/settings', () => {
  it('saves a preference and answers with the whole record', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currency: 'AMD' })
      .expect(200);

    // The whole record, not the patch: the client replaces its cache with
    // this, and answering with only what changed would force a merge.
    expect(response.body).toEqual({ ...DEFAULTS, currency: 'AMD' });
  });

  it('persists across a read', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({ theme: 'atlas' }).expect(200);

    const response = await api().get(SETTINGS).set('Authorization', auth).expect(200);
    expect(response.body.theme).toBe('atlas');
  });

  it('leaves the fields a patch did not mention', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({ currency: 'EUR' });
    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ theme: 'atlas' })
      .expect(200);

    expect(response.body.currency).toBe('EUR');
  });

  it('merges the notifications rather than replacing them', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ notifications: { priceAlerts: true } });

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ notifications: { tripReminders: false } })
      .expect(200);

    // The screen writes one switch at a time. Replacing the object would flip
    // the other one back to its default every time either was touched.
    expect(response.body.notifications).toEqual({ tripReminders: false, priceAlerts: true });
  });

  it('accepts an empty patch', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200);

    expect(response.body).toEqual(DEFAULTS);
  });

  it('refuses a currency the app cannot convert', async () => {
    const { accessToken } = await signUp();

    // Stored happily, it would fall back to dollars on every screen under a
    // label claiming otherwise.
    await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currency: 'XBT' })
      .expect(422);
  });

  it('refuses a theme that is not one of the three', async () => {
    const { accessToken } = await signUp();

    await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ theme: 'neon' })
      .expect(422);
  });

  it('keeps one account’s preferences out of another', async () => {
    const mine = await signUp();
    const theirs = await signUp({ email: 'other@example.com' });

    await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${mine.accessToken}`)
      .send({ currency: 'AMD' });

    const response = await api()
      .get(SETTINGS)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200);

    expect(response.body.currency).toBe('USD');
  });
});

describe('boot in one request', () => {
  it('carries the settings on the account', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;
    await api().put(SETTINGS).set('Authorization', auth).send({ currency: 'AMD', theme: 'atlas' });

    const me = await api().get('/api/me').set('Authorization', auth).expect(200);

    // The whole point: starting the app is one request, not three. The theme
    // and the currency are right by the time anything renders.
    expect(me.body.settings).toEqual({
      theme: 'atlas',
      currency: 'AMD',
      notifications: { tripReminders: true, priceAlerts: false },
      travel: DEFAULT_TRAVEL,
    });
  });

  it('carries the defaults for an account that has never chosen', async () => {
    const { accessToken } = await signUp();

    const me = await api().get('/api/me').set('Authorization', `Bearer ${accessToken}`).expect(200);

    expect(me.body.settings).toEqual(DEFAULTS);
  });

  it('carries them on the sign-in response too', async () => {
    const { accessToken } = await signUp();
    await api().put(SETTINGS).set('Authorization', `Bearer ${accessToken}`).send({ theme: 'atlas' });

    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'correct-horse-battery' })
      .expect(200);

    // Signing in must paint the right theme immediately, without a second
    // request to discover it.
    expect(login.body.user.settings.theme).toBe('atlas');
  });
});

/**
 * The planner's own preferences.
 *
 * These are the fields that decide what a trip actually contains — the hours,
 * the categories and the budget the scheduler plans against — so the merge
 * rules matter more here than anywhere else in this record. A weight reset by
 * a patch that never mentioned it is a category silently dropped from
 * somebody's holiday.
 */
describe('PUT /api/settings, travel preferences', () => {
  it('saves the hours somebody keeps', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ travel: { dayStart: '11:00', dayEnd: '22:00' } })
      .expect(200);

    expect(response.body.travel.dayStart).toBe('11:00');
    expect(response.body.travel.dayEnd).toBe('22:00');
    // Untouched, and still the default rather than empty.
    expect(response.body.travel.pace).toBe('balanced');
  });

  it('refuses a time that is not one', async () => {
    const { accessToken } = await signUp();

    await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ travel: { dayStart: '25:00' } })
      .expect(422);
  });

  it('merges category weights one at a time', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({
      travel: { categoryWeights: { nature: 1 } },
    });

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ travel: { categoryWeights: { culture: 0 } } })
      .expect(200);

    // The screen moves one slider at a time; the first must survive the second.
    expect(response.body.travel.categoryWeights.nature).toBe(1);
    expect(response.body.travel.categoryWeights.culture).toBe(0);
    expect(response.body.travel.categoryWeights.food).toBe(0.5);
  });

  it('refuses a category it has never heard of', async () => {
    const { accessToken } = await signUp();

    await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ travel: { categoryWeights: { nightlife: 1 } } })
      .expect(422);
  });

  it('refuses a weight outside nought to one', async () => {
    const { accessToken } = await signUp();

    await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ travel: { categoryWeights: { food: 4 } } })
      .expect(422);
  });

  it('takes a budget and gives it back', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ travel: { maxActivityPrice: 40, dailyActivityBudget: 120 } })
      .expect(200);

    expect(response.body.travel.maxActivityPrice).toBe(40);
    expect(response.body.travel.dailyActivityBudget).toBe(120);
  });

  it('lets a budget be cleared once it has been set', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({
      travel: { maxActivityPrice: 40 },
    });

    // Null is a value here — "no ceiling" — and has to be reachable again.
    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ travel: { maxActivityPrice: null } })
      .expect(200);

    expect(response.body.travel.maxActivityPrice).toBeNull();
  });

  it('leaves a budget alone when the patch does not mention it', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({
      travel: { maxActivityPrice: 40 },
    });

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ travel: { pace: 'packed' } })
      .expect(200);

    expect(response.body.travel.maxActivityPrice).toBe(40);
    expect(response.body.travel.pace).toBe('packed');
  });

  it('leaves the meal slots as they were set', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({
      travel: { meals: { dinner: false } },
    });

    const response = await api().get(SETTINGS).set('Authorization', auth).expect(200);

    expect(response.body.travel.meals).toEqual({ lunch: true, dinner: false });
  });

  it('does not disturb the rest of the record', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({ theme: 'atlas', currency: 'EUR' });

    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ travel: { pace: 'relaxed' } })
      .expect(200);

    expect(response.body.theme).toBe('atlas');
    expect(response.body.currency).toBe('EUR');
    expect(response.body.notifications).toEqual({ tripReminders: true, priceAlerts: false });
  });
});
