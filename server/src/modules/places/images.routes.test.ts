import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../test/harness';
import { resetImagesCache } from './images.routes';

/**
 * `GET /api/images/wikidata`.
 *
 * The cache is what these tests are really about. Caching an absence is the
 * point of the endpoint — most entities have no photograph, and without
 * remembering that, every grid re-asks Wikidata about all of them. But the
 * same cache must never remember a *failure* as an absence, because Wikidata
 * fails a whole batch when one id in it does not exist.
 */

const IMAGES = '/api/images/wikidata';

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: URL | string, _init?: RequestInit) =>
    implementation(String(input)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const ENTITY = { claims: { P18: [{ mainsnak: { datavalue: { value: 'A.jpg' } } }] } };

const PAGE = {
  title: 'File:A.jpg',
  imageinfo: [
    {
      thumburl: 'https://upload.example/A.jpg',
      descriptionurl: 'https://commons.example/File:A.jpg',
      extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
    },
  ],
};

function bothStagesAnswer() {
  return stubFetch(async (url) =>
    url.includes('wikidata') ? json({ entities: { Q1: ENTITY } }) : json({ query: { pages: [PAGE] } }),
  );
}

beforeEach(() => {
  resetImagesCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetImagesCache();
});

describe('GET /api/images/wikidata', () => {
  it('returns a photograph keyed by entity id', async () => {
    bothStagesAnswer();

    const response = await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);

    expect(response.body.Q1.url).toBe('https://upload.example/A.jpg');
    expect(response.body.Q1.license).toBe('CC BY-SA 4.0');
  });

  it('rejects an id that is not a Wikidata id', async () => {
    await api().get(IMAGES).query({ ids: 'notanid' }).expect(422);
  });

  it('rejects a request naming no ids', async () => {
    await api().get(IMAGES).expect(422);
  });

  it('serves a second request for the same entity from cache', async () => {
    const provider = bothStagesAnswer();

    await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);
    await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);

    // Two calls for the first request, one per stage; nothing for the second.
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('remembers that an entity has no photograph', async () => {
    const provider = stubFetch(async (url) =>
      url.includes('wikidata') ? json({ entities: { Q1: { claims: {} } } }) : json({ query: { pages: [] } }),
    );

    await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);
    const before = provider.mock.calls.length;
    await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);

    // The whole reason for caching absence: most entities have none, and
    // re-asking about all of them on every grid is the expensive case.
    expect(provider.mock.calls.length).toBe(before);
  });

  it('does not remember a failed lookup as "no photograph"', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);

    // Now the provider recovers. The entity must be looked up again rather
    // than answered from a cached blank — otherwise one unknown id in an
    // earlier batch blanks a real attraction for the whole TTL.
    bothStagesAnswer();

    const response = await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);

    expect(response.body.Q1?.url).toBe('https://upload.example/A.jpg');
  });

  it('answers with an empty object rather than failing when Wikimedia is down', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    const response = await api().get(IMAGES).query({ ids: 'Q1' }).expect(200);

    // A card without a photograph beats a grid that refuses to render.
    expect(response.body).toEqual({});
  });
});
