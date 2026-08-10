import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../test/harness';
import { resetReferenceCache } from './reference.routes';

/**
 * `GET /api/reference/*` — the country and city lists.
 *
 * These assertions came from the client's own suite when the fetch moved here:
 * the provider's `Iso2` spelling, its unsorted order and its rows missing half
 * a record are its shape, and belong wherever we speak its dialect.
 */

const COUNTRIES = '/api/reference/countries';

function providerAnswers(body: unknown, status = 200) {
  return vi.fn(
    async (_url: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

function isoBody(rows: { name: string; Iso2: string }[]) {
  return { error: false, msg: 'ok', data: rows };
}

beforeEach(() => {
  resetReferenceCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetReferenceCache();
});

describe('GET /api/reference/countries', () => {
  it('maps the provider’s rows to name and code', async () => {
    vi.stubGlobal('fetch', providerAnswers(isoBody([{ name: 'Spain', Iso2: 'ES' }])));

    const response = await api().get(COUNTRIES).expect(200);

    expect(response.body).toEqual([{ name: 'Spain', code: 'ES' }]);
  });

  it('sorts alphabetically', async () => {
    vi.stubGlobal(
      'fetch',
      providerAnswers(
        isoBody([
          { name: 'Spain', Iso2: 'ES' },
          { name: 'Albania', Iso2: 'AL' },
          { name: 'Japan', Iso2: 'JP' },
        ]),
      ),
    );

    const response = await api().get(COUNTRIES).expect(200);

    expect(response.body.map((row: { name: string }) => row.name)).toEqual([
      'Albania',
      'Japan',
      'Spain',
    ]);
  });

  it('normalises the ISO code to upper case', async () => {
    vi.stubGlobal('fetch', providerAnswers(isoBody([{ name: 'Spain', Iso2: 'es' }])));

    const response = await api().get(COUNTRIES).expect(200);

    expect(response.body[0].code).toBe('ES');
  });

  it('drops a row missing either half', async () => {
    vi.stubGlobal(
      'fetch',
      providerAnswers(
        isoBody([
          { name: 'Spain', Iso2: 'ES' },
          { name: '', Iso2: 'XX' },
          { name: 'Nowhere', Iso2: '' },
          { name: 'Bad', Iso2: 'TOOLONG' },
        ]),
      ),
    );

    // The name keys the city lookup and the code disambiguates the city for
    // OpenTripMap; a row missing either is unusable rather than partial.
    const response = await api().get(COUNTRIES).expect(200);

    expect(response.body).toEqual([{ name: 'Spain', code: 'ES' }]);
  });

  it('fails rather than serving an empty country list', async () => {
    vi.stubGlobal('fetch', providerAnswers(isoBody([])));

    // A picker with nothing in it is not a valid answer — it is a provider we
    // could not read, and the client has a stale copy that beats it.
    await api().get(COUNTRIES).expect(502);
  });

  it('answers a second request from cache', async () => {
    const provider = providerAnswers(isoBody([{ name: 'Spain', Iso2: 'ES' }]));
    vi.stubGlobal('fetch', provider);

    await api().get(COUNTRIES).expect(200);
    await api().get(COUNTRIES).expect(200);

    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/reference/countries/:country/cities', () => {
  const SPAIN = '/api/reference/countries/Spain/cities';

  it('sorts and de-duplicates the names the source repeats', async () => {
    vi.stubGlobal(
      'fetch',
      providerAnswers({ error: false, data: ['Valencia', 'Valencia', 'Madrid'] }),
    );

    // The source repeats a name when two regions share it; the selector has no
    // way to tell them apart, so one entry is all it can honestly offer.
    const response = await api().get(SPAIN).expect(200);

    expect(response.body).toEqual(['Madrid', 'Valencia']);
  });

  it('discards entries that are not usable names', async () => {
    vi.stubGlobal('fetch', providerAnswers({ error: false, data: ['Madrid', '', '   ', 42] }));

    const response = await api().get(SPAIN).expect(200);

    expect(response.body).toEqual(['Madrid']);
  });

  it('accepts an empty list as a real answer', async () => {
    vi.stubGlobal('fetch', providerAnswers({ error: false, data: [] }));

    // Unlike countries: some territories genuinely have no entries, and
    // treating that as a failure would show an error for a correct answer.
    const response = await api().get('/api/reference/countries/Antarctica/cities').expect(200);

    expect(response.body).toEqual([]);
  });

  it('treats the source’s own error flag as a failure', async () => {
    vi.stubGlobal('fetch', providerAnswers({ error: true, msg: 'country not found' }));

    await api().get('/api/reference/countries/Atlantis/cities').expect(502);
  });

  it('escapes a country whose name contains a space', async () => {
    const provider = providerAnswers({ error: false, data: ['Tokyo'] });
    vi.stubGlobal('fetch', provider);

    await api().get('/api/reference/countries/United%20States/cities').expect(200);

    expect(String(provider.mock.calls[0][0])).toContain('country=United%20States');
  });
});
