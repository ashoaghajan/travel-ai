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

const DEFAULTS = {
  theme: 'system',
  currency: 'USD',
  notifications: { tripReminders: true, priceAlerts: false },
};

describe('authentication', () => {
  it('refuses a read with no token', async () => {
    await api().get(SETTINGS).expect(401);
  });

  it('refuses a write with no token', async () => {
    await api().put(SETTINGS).send({ theme: 'dark' }).expect(401);
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

    await api().put(SETTINGS).set('Authorization', auth).send({ theme: 'dark' }).expect(200);

    const response = await api().get(SETTINGS).set('Authorization', auth).expect(200);
    expect(response.body.theme).toBe('dark');
  });

  it('leaves the fields a patch did not mention', async () => {
    const { accessToken } = await signUp();
    const auth = `Bearer ${accessToken}`;

    await api().put(SETTINGS).set('Authorization', auth).send({ currency: 'EUR' });
    const response = await api()
      .put(SETTINGS)
      .set('Authorization', auth)
      .send({ theme: 'dark' })
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
    await api().put(SETTINGS).set('Authorization', auth).send({ currency: 'AMD', theme: 'dark' });

    const me = await api().get('/api/me').set('Authorization', auth).expect(200);

    // The whole point: starting the app is one request, not three. The theme
    // and the currency are right by the time anything renders.
    expect(me.body.settings).toEqual({
      theme: 'dark',
      currency: 'AMD',
      notifications: { tripReminders: true, priceAlerts: false },
    });
  });

  it('carries the defaults for an account that has never chosen', async () => {
    const { accessToken } = await signUp();

    const me = await api().get('/api/me').set('Authorization', `Bearer ${accessToken}`).expect(200);

    expect(me.body.settings).toEqual(DEFAULTS);
  });

  it('carries them on the sign-in response too', async () => {
    const { accessToken } = await signUp();
    await api().put(SETTINGS).set('Authorization', `Bearer ${accessToken}`).send({ theme: 'dark' });

    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'correct-horse-battery' })
      .expect(200);

    // Signing in must paint the right theme immediately, without a second
    // request to discover it.
    expect(login.body.user.settings.theme).toBe('dark');
  });
});
