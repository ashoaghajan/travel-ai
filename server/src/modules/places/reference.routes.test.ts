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

describe('GET /api/reference/location', () => {
  const YEREVAN = '/api/reference/location?lat=40.1776&lon=44.5126';

  /**
   * Two providers answer one request here — OpenStreetMap for the point, and
   * CountriesNow for how we spell the country it lands in — so the stub has to
   * route rather than reply.
   */
  function providersAnswer(
    reverse: unknown,
    countries: { name: string; Iso2: string }[] = [{ name: 'Armenia', Iso2: 'AM' }],
  ) {
    return vi.fn(async (url: URL | string) => {
      const body = String(url).includes('nominatim') ? reverse : isoBody(countries);
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  function osm(address: Record<string, unknown>) {
    return { address };
  }

  it('answers with a country, a code and a city', async () => {
    vi.stubGlobal(
      'fetch',
      providersAnswer(osm({ city: 'Yerevan', country: 'Armenia', country_code: 'am' })),
    );

    const response = await api().get(YEREVAN).expect(200);

    expect(response.body).toEqual({
      countryCode: 'AM',
      countryName: 'Armenia',
      city: 'Yerevan',
    });
  });

  it('spells the country the way the city list spells it', async () => {
    vi.stubGlobal(
      'fetch',
      providersAnswer(osm({ city: 'Istanbul', country: 'Türkiye', country_code: 'tr' }), [
        { name: 'Turkey', Iso2: 'TR' },
      ]),
    );

    // Load-bearing: `/reference/countries/:country/cities` is keyed by name, so
    // handing back OpenStreetMap's spelling would seat the reader in a country
    // whose cities then fail to load.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body.countryName).toBe('Turkey');
  });

  it('falls back to the source’s own name when the country list will not load', async () => {
    vi.stubGlobal('fetch', async (url: URL | string) =>
      String(url).includes('nominatim')
        ? new Response(
            JSON.stringify(osm({ city: 'Yerevan', country: 'Armenia', country_code: 'am' })),
            { status: 200 },
          )
        : new Response('nope', { status: 500 }),
    );

    const response = await api().get(YEREVAN).expect(200);

    expect(response.body).toMatchObject({ countryCode: 'AM', countryName: 'Armenia' });
  });

  it('takes the most specific settlement the address offers', async () => {
    vi.stubGlobal(
      'fetch',
      providersAnswer(
        osm({ village: 'Garni', county: 'Kotayk', country: 'Armenia', country_code: 'am' }),
      ),
    );

    const response = await api().get(YEREVAN).expect(200);

    expect(response.body.city).toBe('Garni');
  });

  it('reads a point at sea as a place nobody is in, not as a failure', async () => {
    vi.stubGlobal('fetch', providersAnswer({ error: 'Unable to geocode' }));

    const response = await api().get('/api/reference/location?lat=0&lon=0').expect(200);

    expect(response.body).toEqual({ countryCode: null, countryName: null, city: null });
  });

  it('answers a nearby second request from cache', async () => {
    const provider = providersAnswer(
      osm({ city: 'Yerevan', country: 'Armenia', country_code: 'am' }),
    );
    vi.stubGlobal('fetch', provider);

    await api().get(YEREVAN).expect(200);
    const before = provider.mock.calls.length;

    // Eleven metres away — inside the ~110 m the key rounds to.
    await api().get('/api/reference/location?lat=40.17761&lon=44.51261').expect(200);

    expect(provider.mock.calls.length).toBe(before);
  });

  it.each([
    ['?lat=91&lon=0'],
    ['?lat=0&lon=181'],
    ['?lat=here&lon=there'],
    ['?lat=40.1776'],
  ])('rejects %s', async (query) => {
    await api().get(`/api/reference/location${query}`).expect(422);
  });

  /**
   * Three providers now: the point, the country list that spells the country,
   * and the city list that decides which of the geocoder's names is the city.
   */
  function withCityList(reverse: unknown, cityList: string[]) {
    return vi.fn(async (url: URL | string) => {
      const href = String(url);
      const body = href.includes('nominatim')
        ? reverse
        : href.includes('/cities')
          ? { error: false, data: cityList }
          : isoBody([{ name: 'United Arab Emirates', Iso2: 'AE' }]);

      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  it('prefers a name the city list knows over a more specific one it does not', async () => {
    vi.stubGlobal(
      'fetch',
      withCityList(
        osm({
          city: 'Al Maryah Island',
          county: 'Abu Dhabi',
          country: 'United Arab Emirates',
          country_code: 'ae',
        }),
        ['Abu Dhabi', 'Dubai'],
      ),
    );

    // OpenStreetMap tags a business district of Abu Dhabi as a city, so the
    // most specific name is the wrong one and no amount of reading the address
    // more carefully fixes it. The list the reader's own city box is backed by
    // is what tells the two apart.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body.city).toBe('Abu Dhabi');
  });

  it('answers with the list’s spelling, not the geocoder’s', async () => {
    vi.stubGlobal(
      'fetch',
      withCityList(
        osm({ city: 'Brasov', country: 'United Arab Emirates', country_code: 'ae' }),
        ['Brașov'],
      ),
    );

    // The name goes back into the city box, where the type-ahead matches it
    // against this list — so it has to be a string that list contains.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body.city).toBe('Brașov');
  });

  it('leaves the city empty rather than naming a district nobody could pick', async () => {
    vi.stubGlobal(
      'fetch',
      withCityList(
        osm({
          suburb: 'Al Thanyah 5',
          state: 'Dubai Emirate',
          country: 'United Arab Emirates',
          country_code: 'ae',
        }),
        ['Abu Dhabi', 'Dubai'],
      ),
    );

    // A country and no city is a working screen — the country selector is
    // seated and the reader types one word. A neighbourhood in the city box is
    // a wrong one.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body).toMatchObject({ countryCode: 'AE', city: null });
  });

  it('never answers with a suburb, even one the list happens to know', async () => {
    vi.stubGlobal(
      'fetch',
      withCityList(
        osm({
          suburb: 'Musaffah',
          city: 'Abu Dhabi',
          country: 'United Arab Emirates',
          country_code: 'ae',
        }),
        ['Abu Dhabi', 'Musaffah'],
      ),
    );

    // Some genuine neighbourhoods share a name with a listed city. Preferring
    // one would put a district in the box for a reader standing in the city.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body.city).toBe('Abu Dhabi');
  });

  it('answers with no city when the list recognises none of the names', async () => {
    vi.stubGlobal(
      'fetch',
      withCityList(
        osm({
          city: 'Al Maryah Island',
          state: 'Abu Dhabi Emirate',
          country: 'United Arab Emirates',
          country_code: 'ae',
        }),
        ['Abu Dhabi', 'Dubai'],
      ),
    );

    // Not even as a last resort. A name the list does not hold is one the city
    // box cannot complete and the reader has no way to check — and it would
    // silently narrow the search to a district nobody chose.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body).toMatchObject({ countryName: 'United Arab Emirates', city: null });
  });

  it('keeps the geocoder’s own answer when the city list will not load', async () => {
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const href = String(url);
      if (href.includes('nominatim')) {
        return new Response(
          JSON.stringify(osm({ city: 'Abu Dhabi', country: 'UAE', country_code: 'ae' })),
          { status: 200 },
        );
      }
      if (href.includes('/cities')) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify(isoBody([{ name: 'United Arab Emirates', Iso2: 'AE' }])), {
        status: 200,
      });
    });

    // A list that will not load costs the check, not the answer.
    const response = await api().get(YEREVAN).expect(200);

    expect(response.body.city).toBe('Abu Dhabi');
  });

  it('asks the geocoder for the neighbourhood, whose address names the real city', async () => {
    const provider = providersAnswer(osm({ city: 'Yerevan', country: 'Armenia', country_code: 'am' }));
    vi.stubGlobal('fetch', provider);

    await api().get(YEREVAN).expect(200);

    // Zoom 14, not 10: at 10 the match is whatever boundary encloses the point,
    // and a mis-tagged district *is* that boundary.
    const call = provider.mock.calls.find(([url]) => String(url).includes('nominatim'));
    expect(String(call?.[0])).toContain('zoom=14');
  });

  it('reports an unreachable geocoder rather than guessing', async () => {
    vi.stubGlobal('fetch', async (url: URL | string) => {
      if (String(url).includes('nominatim')) throw new Error('offline');
      return new Response(JSON.stringify(isoBody([{ name: 'Armenia', Iso2: 'AM' }])), {
        status: 200,
      });
    });

    await api().get(YEREVAN).expect(502);
  });
});
